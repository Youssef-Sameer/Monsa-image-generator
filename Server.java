// Monsa Studio server. Run with:  java Server.java   (or double-click start.bat)
// No extra libraries needed: uses only what comes with Java 17+.

import com.sun.net.httpserver.*;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.PBEKeySpec;
import java.io.*;
import java.net.*;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.SecureRandom;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.zip.*;

public class Server {
    static final Path ROOT = Paths.get("").toAbsolutePath();
    static final Path PUBLIC = ROOT.resolve("public");
    static final Path CONFIG = ROOT.resolve("config");
    static final Path DATA = ROOT.resolve("data");
    static final Path STORAGE = ROOT.resolve("storage");
    static final String POLLINATIONS = "https://gen.pollinations.ai";
    static final Map<String, String> sessions = new ConcurrentHashMap<>();
    static final SecureRandom random = new SecureRandom();
    static final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(30))
            .followRedirects(HttpClient.Redirect.NORMAL).build();

    public static void main(String[] args) throws Exception {
        for (String d : List.of("products", "models", "gallery", "tmp", "brand")) Files.createDirectories(STORAGE.resolve(d));
        Files.createDirectories(DATA);
        int port = Integer.parseInt(Optional.ofNullable(System.getenv("PORT")).orElse("8080"));
        HttpServer server = HttpServer.create(new InetSocketAddress(port), 0);
        server.createContext("/", Server::handle);
        server.setExecutor(Executors.newFixedThreadPool(16));
        server.start();
        System.out.println("Monsa Studio is running: open http://localhost:" + port + " in your browser.");
        System.out.println("To stop it, close this window.");
    }

    // ---------- request routing ----------

    static class HttpError extends RuntimeException {
        final int status;
        HttpError(int status, String msg) { super(msg); this.status = status; }
    }

    static void handle(HttpExchange ex) {
        try {
            String path = ex.getRequestURI().getPath();
            if (path.startsWith("/api/")) api(ex, path.substring(4), ex.getRequestMethod());
            else if (path.startsWith("/files/")) serveStorage(ex, path.substring(7));
            else serveStatic(ex, path);
        } catch (HttpError e) {
            sendJson(ex, e.status, Map.of("error", e.getMessage()));
        } catch (Exception e) {
            e.printStackTrace();
            sendJson(ex, 500, Map.of("error", "Server error: " + e.getMessage()));
        } finally {
            ex.close();
        }
    }

    static void api(HttpExchange ex, String p, String method) throws Exception {
        boolean GET = method.equals("GET"), POST = method.equals("POST");
        if (GET && p.equals("/state")) { state(ex); return; }
        if (POST && p.equals("/setup")) { setup(ex); return; }
        if (POST && p.equals("/login")) { login(ex); return; }
        if (POST && p.equals("/logout")) { logout(ex); return; }

        Map<String, Object> user = requireUser(ex);
        boolean admin = "admin".equals(user.get("role"));

        // everyday features
        if (GET && p.equals("/options")) { sendJson(ex, 200, publicOptions(admin)); return; }
        if (GET && p.equals("/products")) { sendJson(ex, 200, Store.list("products")); return; }
        if (POST && p.equals("/products")) { createProduct(ex, user); return; }
        if (POST && p.startsWith("/products/") && p.endsWith("/delete")) { deleteProduct(ex, user, admin, p.split("/")[2]); return; }
        if (GET && p.equals("/models")) { sendJson(ex, 200, visibleModels(admin)); return; }
        if (POST && p.equals("/models/sheet")) { modelSheet(ex, user); return; }
        if (POST && p.equals("/models/save")) { saveModel(ex, user); return; }
        if (POST && p.equals("/prompt")) { promptPreview(ex); return; }
        if (POST && p.equals("/generate")) { generate(ex, user); return; }
        if (POST && p.equals("/edit")) { editImage(ex, user); return; }
        if (POST && p.equals("/gallery/upload")) { uploadResult(ex, user); return; }
        if (GET && p.equals("/gallery")) { sendJson(ex, 200, gallery(user, admin, query(ex))); return; }
        if (POST && p.startsWith("/gallery/") && p.endsWith("/delete")) { deleteGallery(ex, user, admin, p.split("/")[2]); return; }
        if (GET && p.equals("/gallery/zip")) { zip(ex, user, admin, query(ex)); return; }
        if (GET && p.equals("/usage")) { sendJson(ex, 200, usage(user)); return; }

        if (!admin) throw new HttpError(403, "Admins only.");
        if (GET && p.equals("/admin/options")) { sendJson(ex, 200, Store.options()); return; }
        if (POST && p.equals("/admin/options")) { saveAdminOptions(ex, user); return; }
        if (GET && p.equals("/admin/prompts")) { sendJson(ex, 200, Store.prompts()); return; }
        if (POST && p.equals("/admin/prompts")) { Store.save("prompts", body(ex)); log(user, "Edited prompts"); ok(ex); return; }
        if (POST && p.equals("/admin/prompts/reset")) { Files.deleteIfExists(DATA.resolve("prompts.json")); log(user, "Reset prompts to default"); ok(ex); return; }
        if (POST && p.equals("/admin/options/reset")) { Files.deleteIfExists(DATA.resolve("options.json")); log(user, "Reset options to default"); ok(ex); return; }
        if (POST && p.equals("/admin/models")) { Store.save("models", body(ex).get("models")); log(user, "Edited model library"); ok(ex); return; }
        if (GET && p.equals("/admin/settings")) { sendJson(ex, 200, maskedSettings()); return; }
        if (POST && p.equals("/admin/settings")) { saveSettings(ex, user); return; }
        if (GET && p.equals("/admin/users")) { sendJson(ex, 200, safeUsers()); return; }
        if (POST && p.equals("/admin/users")) { saveUser(ex, user); return; }
        if (GET && p.equals("/admin/log")) { sendJson(ex, 200, Store.list("log")); return; }
        if (GET && p.equals("/admin/stats")) { sendJson(ex, 200, stats()); return; }
        throw new HttpError(404, "Not found: " + p);
    }

    // ---------- auth ----------

    static void state(HttpExchange ex) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("needsSetup", Store.list("users").isEmpty());
        Map<String, Object> u = currentUser(ex);
        out.put("user", u == null ? null : publicUser(u));
        out.put("siteName", str(Store.settings().get("siteName"), "Monsa Studio"));
        sendJson(ex, 200, out);
    }

    static void setup(HttpExchange ex) throws Exception {
        synchronized (Store.class) {
            if (!Store.list("users").isEmpty()) throw new HttpError(400, "Setup was already done.");
            Map<String, Object> b = body(ex);
            Map<String, Object> u = newUser(b, "admin");
            Store.save("users", new ArrayList<>(List.of(u)));
            log(u, "Created first admin account");
            startSession(ex, u);
        }
        ok(ex);
    }

    static void login(HttpExchange ex) throws Exception {
        Map<String, Object> b = body(ex);
        String email = str(b.get("email"), "").trim().toLowerCase();
        for (Map<String, Object> u : Store.list("users")) {
            if (email.equals(u.get("email")) && checkPassword(str(b.get("password"), ""), u)) {
                if (Boolean.TRUE.equals(u.get("disabled"))) throw new HttpError(403, "This account is disabled.");
                startSession(ex, u);
                ok(ex);
                return;
            }
        }
        throw new HttpError(401, "Wrong email or password.");
    }

    static void logout(HttpExchange ex) {
        String t = cookie(ex, "monsa_session");
        if (t != null) sessions.remove(t);
        ex.getResponseHeaders().add("Set-Cookie", "monsa_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax");
        ok(ex);
    }

    static void startSession(HttpExchange ex, Map<String, Object> u) {
        String token = randomId(24);
        sessions.put(token, (String) u.get("id"));
        ex.getResponseHeaders().add("Set-Cookie", "monsa_session=" + token + "; Path=/; Max-Age=2592000; HttpOnly; SameSite=Lax");
    }

    static Map<String, Object> currentUser(HttpExchange ex) {
        String t = cookie(ex, "monsa_session");
        if (t == null || !sessions.containsKey(t)) return null;
        Map<String, Object> u = Store.find("users", sessions.get(t));
        if (u == null || Boolean.TRUE.equals(u.get("disabled"))) return null;
        return u;
    }

    static Map<String, Object> requireUser(HttpExchange ex) {
        Map<String, Object> u = currentUser(ex);
        if (u == null) throw new HttpError(401, "Please log in.");
        return u;
    }

    static Map<String, Object> newUser(Map<String, Object> b, String role) throws Exception {
        String email = str(b.get("email"), "").trim().toLowerCase();
        String pass = str(b.get("password"), "");
        if (!email.contains("@")) throw new HttpError(400, "Please enter a valid email.");
        if (pass.length() < 6) throw new HttpError(400, "Password must be at least 6 characters.");
        Map<String, Object> u = new LinkedHashMap<>();
        u.put("id", randomId(8));
        u.put("name", str(b.get("name"), email));
        u.put("email", email);
        u.put("role", role);
        u.put("disabled", false);
        u.put("monthlyLimit", 0);
        setPassword(u, pass);
        u.put("createdAt", Instant.now().toString());
        return u;
    }

    static void setPassword(Map<String, Object> u, String pass) throws Exception {
        byte[] salt = new byte[16];
        random.nextBytes(salt);
        u.put("salt", Base64.getEncoder().encodeToString(salt));
        u.put("hash", hash(pass, salt));
    }

    static boolean checkPassword(String pass, Map<String, Object> u) throws Exception {
        return hash(pass, Base64.getDecoder().decode((String) u.get("salt"))).equals(u.get("hash"));
    }

    static String hash(String pass, byte[] salt) throws Exception {
        PBEKeySpec spec = new PBEKeySpec(pass.toCharArray(), salt, 120000, 256);
        return Base64.getEncoder().encodeToString(SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).getEncoded());
    }

    static Map<String, Object> publicUser(Map<String, Object> u) {
        Map<String, Object> o = new LinkedHashMap<>(u);
        o.remove("salt");
        o.remove("hash");
        return o;
    }

    static List<Object> safeUsers() {
        List<Object> out = new ArrayList<>();
        for (Map<String, Object> u : Store.list("users")) out.add(publicUser(u));
        return out;
    }

    static void saveUser(HttpExchange ex, Map<String, Object> admin) throws Exception {
        Map<String, Object> b = body(ex);
        synchronized (Store.class) {
            List<Map<String, Object>> users = Store.list("users");
            String id = str(b.get("id"), "");
            if (Boolean.TRUE.equals(b.get("delete"))) {
                if (id.equals(admin.get("id"))) throw new HttpError(400, "You can't delete your own account.");
                users.removeIf(u -> id.equals(u.get("id")));
                log(admin, "Deleted user " + id);
            } else if (id.isEmpty()) {
                String email = str(b.get("email"), "").trim().toLowerCase();
                if (users.stream().anyMatch(u -> email.equals(u.get("email")))) throw new HttpError(400, "That email already exists.");
                Map<String, Object> u = newUser(b, "admin".equals(b.get("role")) ? "admin" : "user");
                users.add(u);
                log(admin, "Added user " + u.get("email"));
            } else {
                Map<String, Object> u = users.stream().filter(x -> id.equals(x.get("id"))).findFirst()
                        .orElseThrow(() -> new HttpError(404, "User not found."));
                if (b.containsKey("name")) u.put("name", b.get("name"));
                if (b.containsKey("role")) u.put("role", "admin".equals(b.get("role")) ? "admin" : "user");
                if (b.containsKey("disabled")) u.put("disabled", Boolean.TRUE.equals(b.get("disabled")));
                if (b.containsKey("monthlyLimit")) u.put("monthlyLimit", num(b.get("monthlyLimit")));
                String pass = str(b.get("password"), "");
                if (!pass.isEmpty()) {
                    if (pass.length() < 6) throw new HttpError(400, "Password must be at least 6 characters.");
                    setPassword(u, pass);
                }
                log(admin, "Updated user " + u.get("email"));
            }
            Store.save("users", users);
        }
        ok(ex);
    }

    // ---------- options, settings ----------

    @SuppressWarnings("unchecked")
    static Map<String, Object> publicOptions(boolean admin) {
        Map<String, Object> o = Store.options();
        Map<String, Object> out = new LinkedHashMap<>();
        for (Map.Entry<String, Object> e : o.entrySet()) {
            if (e.getValue() instanceof List) {
                List<Object> kept = new ArrayList<>();
                for (Object item : (List<Object>) e.getValue())
                    if (!(item instanceof Map) || !Boolean.FALSE.equals(((Map<String, Object>) item).get("enabled"))) kept.add(item);
                out.put(e.getKey(), kept);
            } else out.put(e.getKey(), e.getValue());
        }
        Map<String, Object> s = Store.settings();
        out.put("hasKey", !str(s.get("pollinationsKey"), "").isEmpty());
        out.put("siteName", str(s.get("siteName"), "Monsa Studio"));
        return out;
    }

    static void saveAdminOptions(HttpExchange ex, Map<String, Object> user) throws Exception {
        Map<String, Object> b = body(ex);
        Store.save("options", b);
        log(user, "Edited options/feature toggles");
        ok(ex);
    }

    static Map<String, Object> maskedSettings() {
        Map<String, Object> s = new LinkedHashMap<>(Store.settings());
        String key = str(s.get("pollinationsKey"), "");
        s.put("pollinationsKey", key.isEmpty() ? "" : "********" + key.substring(Math.max(0, key.length() - 4)));
        s.put("hasKey", !key.isEmpty());
        return s;
    }

    static void saveSettings(HttpExchange ex, Map<String, Object> user) throws Exception {
        Map<String, Object> b = body(ex);
        Map<String, Object> s = new LinkedHashMap<>(Store.settings());
        for (String k : List.of("siteName", "monthlyCostLimit")) if (b.containsKey(k)) s.put(k, b.get(k));
        String key = str(b.get("pollinationsKey"), "");
        if (Boolean.TRUE.equals(b.get("clearKey"))) s.put("pollinationsKey", "");
        else if (!key.isEmpty() && !key.startsWith("****")) s.put("pollinationsKey", key.trim());
        Store.save("settings", s);
        log(user, "Changed settings");
        ok(ex);
    }

    // ---------- products ----------

    static void createProduct(HttpExchange ex, Map<String, Object> user) throws Exception {
        Map<String, Object> b = body(ex);
        List<Object> imgs = listOf(b.get("images"));
        if (imgs.isEmpty()) throw new HttpError(400, "Please add at least one photo.");
        String id = randomId(8);
        List<Object> files = new ArrayList<>();
        int i = 0;
        for (Object d : imgs) files.add(saveDataUrl((String) d, "products/" + id + "-" + (i++)));
        Map<String, Object> p = new LinkedHashMap<>();
        p.put("id", id);
        p.put("name", str(b.get("name"), "Product " + id));
        p.put("type", str(b.get("type"), "bag"));
        p.put("images", files);
        p.put("userId", user.get("id"));
        p.put("createdAt", Instant.now().toString());
        Store.add("products", p);
        log(user, "Uploaded product " + p.get("name"));
        sendJson(ex, 200, p);
    }

    static void deleteProduct(HttpExchange ex, Map<String, Object> user, boolean admin, String id) {
        Map<String, Object> p = Store.find("products", id);
        if (p == null) throw new HttpError(404, "Product not found.");
        if (!admin && !user.get("id").equals(p.get("userId"))) throw new HttpError(403, "You can only delete your own products.");
        Store.remove("products", id);
        log(user, "Deleted product " + p.get("name"));
        ok(ex);
    }

    // ---------- model library ----------

    @SuppressWarnings("unchecked")
    static List<Object> visibleModels(boolean admin) {
        List<Object> out = new ArrayList<>();
        for (Object m : Store.models()) if (admin || !Boolean.FALSE.equals(((Map<String, Object>) m).get("enabled"))) out.add(m);
        return out;
    }

    static void modelSheet(HttpExchange ex, Map<String, Object> user) throws Exception {
        Map<String, Object> b = body(ex);
        String prompt = fill(str(Store.prompts().get("modelSheet"), ""), Map.of("description", str(b.get("description"), "")));
        List<Path> refs = new ArrayList<>();
        for (Object d : listOf(b.get("photos"))) refs.add(STORAGE.resolve(saveDataUrl((String) d, "tmp/ref-" + randomId(6))));
        if (Boolean.TRUE.equals(b.get("promptOnly"))) { sendJson(ex, 200, Map.of("prompt", prompt)); return; }
        Map<String, Object> engine = engine(str(b.get("engine"), ""));
        checkLimits(user, 1, num(engine.get("costPerImage")));
        byte[] img = callEngine(engine, prompt, refs, 1536, 1024, -1);
        String file = saveBytes(img, "tmp/sheet-" + randomId(8));
        recordCost(user, num(engine.get("costPerImage")), "Model sheet");
        sendJson(ex, 200, Map.of("file", file, "prompt", prompt));
    }

    @SuppressWarnings("unchecked")
    static void saveModel(HttpExchange ex, Map<String, Object> user) throws Exception {
        Map<String, Object> b = body(ex);
        synchronized (Store.class) {
            List<Object> models = Store.models();
            String id = str(b.get("id"), "");
            Map<String, Object> m = null;
            for (Object o : models) if (id.equals(((Map<String, Object>) o).get("id"))) m = (Map<String, Object>) o;
            if (m == null) {
                m = new LinkedHashMap<>();
                m.put("id", "model-" + randomId(6));
                m.put("enabled", true);
                m.put("default", false);
                models.add(m);
            }
            m.put("name", str(b.get("name"), "New model"));
            m.put("description", str(b.get("description"), ""));
            List<Object> images = new ArrayList<>();
            for (Object f : listOf(b.get("images"))) {
                String s = (String) f;
                if (s.startsWith("data:")) images.add(saveDataUrl(s, "models/" + m.get("id") + "-" + randomId(4)));
                else if (s.startsWith("tmp/")) {
                    String dest = "models/" + m.get("id") + "-" + randomId(4) + ext(s);
                    Files.copy(safeStorage(s), STORAGE.resolve(dest), StandardCopyOption.REPLACE_EXISTING);
                    images.add(dest);
                } else images.add(s);
            }
            m.put("images", images);
            Store.save("models", models);
            log(user, "Saved model " + m.get("name"));
            sendJson(ex, 200, m);
        }
    }

    // ---------- prompts & generation ----------

    @SuppressWarnings("unchecked")
    static Map<String, Object> pick(String list, Object id) {
        List<Object> items = listOf(Store.options().get(list));
        for (Object o : items) if (((Map<String, Object>) o).get("id").equals(id)) return (Map<String, Object>) o;
        for (Object o : items) if (Boolean.TRUE.equals(((Map<String, Object>) o).get("default"))) return (Map<String, Object>) o;
        return items.isEmpty() ? new LinkedHashMap<>() : (Map<String, Object>) items.get(0);
    }

    @SuppressWarnings("unchecked")
    static Map<String, Object> engine(String id) {
        Map<String, Object> e = pick("engines", id);
        if (e.isEmpty()) throw new HttpError(400, "No image engine is set up. Ask an admin to add one.");
        return e;
    }

    /** Builds the full prompt and the list of reference images for a generation request. */
    @SuppressWarnings("unchecked")
    static Object[] buildJob(Map<String, Object> r) {
        Map<String, Object> P = Store.prompts();
        Map<String, Object> product = Store.find("products", str(r.get("productId"), ""));
        if (product == null) throw new HttpError(400, "Please choose a product first.");
        Map<String, Object> type = pick("productTypes", product.get("type"));
        Map<String, Object> style = pick("styles", r.get("style"));
        boolean onModel = "onModel".equals(r.get("mode"));
        Map<String, Object> model = null;
        if (onModel) {
            for (Object m : Store.models()) if (((Map<String, Object>) m).get("id").equals(r.get("modelId"))) model = (Map<String, Object>) m;
            if (model == null) throw new HttpError(400, "Please choose a model.");
        }
        Map<String, Object> size = pick("sizes", r.get("size"));
        String bg = str(r.get("customColor"), "");
        if (bg.isEmpty()) {
            Map<String, Object> b = pick("backgrounds", r.get("background"));
            bg = str(b.get("name"), "deep blue").toLowerCase() + " (" + str(b.get("color"), "#1f3a8a") + ")";
        } else bg = "the colour " + bg;

        Map<String, String> v = new HashMap<>();
        v.put("product_type", str(type.get("name"), "product").toLowerCase());
        v.put("background", bg);
        v.put("scene", str(pick("scenes", r.get("scene")).get("prompt"), ""));
        v.put("pose", str(pick("poses", r.get("pose")).get("prompt"), ""));
        v.put("framing", str(pick("framings", r.get("framing")).get("prompt"), ""));
        v.put("outfit", str(pick("outfits", r.get("outfit")).get("prompt"), ""));
        v.put("ratio", str(size.get("ratio"), "4:5"));

        List<Path> refs = new ArrayList<>();
        for (Object f : listOf(product.get("images"))) refs.add(safeStorage((String) f));
        int productCount = refs.size();
        if (model != null) for (Object f : listOf(model.get("images"))) refs.add(safeStorage((String) f));
        int modelCount = refs.size() - productCount;
        v.put("product_count", String.valueOf(productCount));
        v.put("model_part", model == null ? "" : (modelCount > 0 ? "; the next " + modelCount + " image(s) show the model" : ""));

        List<String> parts = new ArrayList<>();
        String base = !onModel ? "productOnly" : ("clothing".equals(type.get("id")) ? "clothingOnModel" : "onModel");
        parts.add(str(P.get(base), ""));
        if (model != null) parts.add("The model: " + str(model.get("description"), "") + ".");
        parts.add(str(style.get("prompt"), ""));
        parts.add(str(type.get("prompt"), ""));
        parts.add(str(P.get("references"), ""));
        parts.add(str(P.get("aspect"), ""));
        parts.add(str(P.get("accuracy"), ""));
        String extra = str(r.get("extra"), "").trim();
        if (!extra.isEmpty()) parts.add("Extra notes: " + extra);
        String prompt = fill(String.join("\n\n", parts.stream().filter(s -> !s.isBlank()).toList()), v);
        return new Object[]{prompt, refs, size, product, model, style};
    }

    static void promptPreview(HttpExchange ex) throws Exception {
        Object[] job = buildJob(body(ex));
        List<String> refs = new ArrayList<>();
        for (Object pth : (List<?>) job[1]) refs.add(STORAGE.relativize((Path) pth).toString().replace('\\', '/'));
        sendJson(ex, 200, Map.of("prompt", job[0], "refs", refs));
    }

    @SuppressWarnings("unchecked")
    static void generate(HttpExchange ex, Map<String, Object> user) throws Exception {
        Map<String, Object> r = body(ex);
        Object[] job = buildJob(r);
        String prompt = (String) job[0];
        List<Path> refs = new ArrayList<>((List<Path>) job[1]);
        Map<String, Object> size = (Map<String, Object>) job[2];
        Map<String, Object> engine = engine(str(r.get("engine"), ""));
        String parent = str(r.get("likeImage"), "");
        if (!parent.isEmpty()) {
            refs.add(safeStorage(parent));
            prompt += "\n\n" + str(Store.prompts().get("moreLikeThis"), "");
        }
        int count = (int) Math.max(1, Math.min(4, num(r.getOrDefault("count", 1))));
        double cost = num(engine.get("costPerImage"));
        checkLimits(user, count, cost * count);

        List<Object> results = new ArrayList<>();
        List<String> errors = new ArrayList<>();
        // run variations in parallel
        List<Future<byte[]>> futures = new ArrayList<>();
        ExecutorService pool = Executors.newFixedThreadPool(count);
        final String finalPrompt = prompt;
        for (int i = 0; i < count; i++)
            futures.add(pool.submit(() -> callEngine(engine, finalPrompt, refs, (int) num(size.get("width")), (int) num(size.get("height")), random.nextInt(2_000_000_000))));
        pool.shutdown();
        for (Future<byte[]> f : futures) {
            try {
                byte[] img = f.get();
                results.add(addToGallery(user, img, null, r, prompt, engine, cost, (Map<String, Object>) job[5]));
            } catch (ExecutionException e) {
                errors.add(e.getCause().getMessage());
            }
        }
        if (results.isEmpty()) throw new HttpError(502, errors.isEmpty() ? "Generation failed." : errors.get(0));
        log(user, "Generated " + results.size() + " image(s) of " + ((Map<String, Object>) job[3]).get("name"));
        sendJson(ex, 200, Map.of("images", results, "errors", errors));
    }

    @SuppressWarnings("unchecked")
    static void editImage(HttpExchange ex, Map<String, Object> user) throws Exception {
        Map<String, Object> b = body(ex);
        Map<String, Object> src = Store.find("gallery", str(b.get("imageId"), ""));
        if (src == null) throw new HttpError(404, "Image not found.");
        String instruction = str(b.get("instruction"), "").trim();
        if (instruction.isEmpty()) throw new HttpError(400, "Type what you want to change.");
        Map<String, Object> settings = new LinkedHashMap<>((Map<String, Object>) src.getOrDefault("settings", new LinkedHashMap<>()));
        Map<String, Object> engine = engine(str(b.get("engine"), str(settings.get("engine"), "")));
        List<Path> refs = new ArrayList<>();
        refs.add(safeStorage((String) src.get("file")));
        Map<String, Object> product = Store.find("products", str(src.get("productId"), ""));
        if (product != null) for (Object f : listOf(product.get("images"))) refs.add(safeStorage((String) f));
        String prompt = fill(str(Store.prompts().get("edit"), ""), Map.of("instruction", instruction));
        double cost = num(engine.get("costPerImage"));
        checkLimits(user, 1, cost);
        Map<String, Object> size = pick("sizes", settings.get("size"));
        byte[] img = callEngine(engine, prompt, refs, (int) num(size.get("width")), (int) num(size.get("height")), -1);
        settings.put("editOf", src.get("id"));
        settings.put("instruction", instruction);
        Map<String, Object> style = pick("styles", settings.get("style"));
        Map<String, Object> entry = addToGallery(user, img, null, settings, prompt, engine, cost, style);
        log(user, "Edited image " + src.get("id") + ": " + instruction);
        sendJson(ex, 200, entry);
    }

    @SuppressWarnings("unchecked")
    static void uploadResult(HttpExchange ex, Map<String, Object> user) throws Exception {
        Map<String, Object> b = body(ex);
        Map<String, Object> settings = (Map<String, Object>) b.getOrDefault("settings", new LinkedHashMap<>());
        Map<String, Object> entry = addToGallery(user, null, str(b.get("image"), ""), settings, str(b.get("prompt"), ""),
                Map.of("id", "manual", "name", "Copy prompt (manual)"), 0, pick("styles", settings.get("style")));
        log(user, "Uploaded a result made with Copy prompt");
        sendJson(ex, 200, entry);
    }

    static Map<String, Object> addToGallery(Map<String, Object> user, byte[] img, String dataUrl, Map<String, Object> settings,
                                            String prompt, Map<String, Object> engine, double cost, Map<String, Object> style) throws Exception {
        String id = randomId(10);
        String file = img != null ? saveBytes(img, "gallery/" + id) : saveDataUrl(dataUrl, "gallery/" + id);
        Map<String, Object> s = new LinkedHashMap<>(settings);
        s.remove("likeImage");
        Map<String, Object> e = new LinkedHashMap<>();
        e.put("id", id);
        e.put("file", file);
        e.put("userId", user.get("id"));
        e.put("userName", user.get("name"));
        e.put("productId", str(settings.get("productId"), ""));
        e.put("modelId", "onModel".equals(settings.get("mode")) ? str(settings.get("modelId"), "") : "");
        e.put("style", str(style.get("id"), ""));
        e.put("mode", str(settings.get("mode"), ""));
        e.put("engine", engine.get("id"));
        e.put("engineName", engine.get("name"));
        e.put("cost", cost);
        e.put("prompt", prompt);
        e.put("settings", s);
        e.put("createdAt", Instant.now().toString());
        Store.add("gallery", e);
        return e;
    }

    static List<Object> gallery(Map<String, Object> user, boolean admin, Map<String, String> q) {
        List<Object> out = new ArrayList<>();
        boolean all = admin && "1".equals(q.get("all"));
        List<Map<String, Object>> items = Store.list("gallery");
        Collections.reverse(items);
        for (Map<String, Object> g : items) {
            if (!all && !user.get("id").equals(g.get("userId"))) continue;
            if (!q.getOrDefault("product", "").isEmpty() && !q.get("product").equals(g.get("productId"))) continue;
            if (!q.getOrDefault("model", "").isEmpty() && !q.get("model").equals(g.get("modelId"))) continue;
            if (!q.getOrDefault("style", "").isEmpty() && !q.get("style").equals(g.get("style"))) continue;
            out.add(g);
        }
        return out;
    }

    static void deleteGallery(HttpExchange ex, Map<String, Object> user, boolean admin, String id) throws Exception {
        Map<String, Object> g = Store.find("gallery", id);
        if (g == null) throw new HttpError(404, "Image not found.");
        if (!admin && !user.get("id").equals(g.get("userId"))) throw new HttpError(403, "You can only delete your own images.");
        Store.remove("gallery", id);
        Files.deleteIfExists(safeStorage((String) g.get("file")));
        log(user, "Deleted image " + id);
        ok(ex);
    }

    static void zip(HttpExchange ex, Map<String, Object> user, boolean admin, Map<String, String> q) throws Exception {
        if (!Boolean.TRUE.equals(((Map<?, ?>) Store.options().getOrDefault("features", Map.of())).get("zipDownload")) && !admin)
            throw new HttpError(403, "Zip download is turned off.");
        Set<String> ids = new HashSet<>(Arrays.asList(q.getOrDefault("ids", "").split(",")));
        ex.getResponseHeaders().add("Content-Type", "application/zip");
        ex.getResponseHeaders().add("Content-Disposition", "attachment; filename=\"monsa-images.zip\"");
        ex.sendResponseHeaders(200, 0);
        try (ZipOutputStream z = new ZipOutputStream(ex.getResponseBody())) {
            for (Map<String, Object> g : Store.list("gallery")) {
                if (!ids.contains(g.get("id"))) continue;
                if (!admin && !user.get("id").equals(g.get("userId"))) continue;
                String f = (String) g.get("file");
                z.putNextEntry(new ZipEntry("monsa-" + g.get("id") + ext(f)));
                Files.copy(safeStorage(f), z);
                z.closeEntry();
            }
        }
    }

    // ---------- cost & limits ----------

    static String month() { return YearMonth.now().toString(); }

    static void recordCost(Map<String, Object> user, double cost, String what) {
        Map<String, Object> e = new LinkedHashMap<>();
        e.put("id", randomId(8));
        e.put("userId", user.get("id"));
        e.put("cost", cost);
        e.put("what", what);
        e.put("createdAt", Instant.now().toString());
        Store.add("costs", e);
    }

    static Map<String, Object> usage(Map<String, Object> user) {
        double monthCost = 0, myCost = 0;
        int myImages = 0;
        String m = month();
        for (Map<String, Object> g : costEntries()) {
            if (!str(g.get("createdAt"), "").startsWith(m)) continue;
            monthCost += num(g.get("cost"));
            if (user.get("id").equals(g.get("userId"))) { myCost += num(g.get("cost")); if (g.containsKey("file") && !"manual".equals(g.get("engine"))) myImages++; }
        }
        double limit = num(Store.settings().getOrDefault("monthlyCostLimit", 0));
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("month", m);
        out.put("monthCost", monthCost);
        out.put("myCost", myCost);
        out.put("myImages", myImages);
        out.put("myLimit", num(user.getOrDefault("monthlyLimit", 0)));
        out.put("costLimit", limit);
        out.put("nearLimit", limit > 0 && monthCost >= limit * 0.8);
        return out;
    }

    static List<Map<String, Object>> costEntries() {
        List<Map<String, Object>> all = new ArrayList<>(Store.list("gallery"));
        all.addAll(Store.list("costs"));
        return all;
    }

    static void checkLimits(Map<String, Object> user, int images, double cost) {
        Map<String, Object> u = usage(user);
        double limit = num(u.get("costLimit"));
        if (limit > 0 && num(u.get("monthCost")) + cost > limit)
            throw new HttpError(403, "The monthly cost limit (" + limit + " pollen) has been reached. An admin can raise it in Settings.");
        double myLimit = num(u.get("myLimit"));
        if (myLimit > 0 && num(u.get("myImages")) + images > myLimit)
            throw new HttpError(403, "You reached your monthly limit of " + (int) myLimit + " images.");
    }

    @SuppressWarnings("unchecked")
    static Map<String, Object> stats() {
        String today = LocalDate.now().toString(), m = month();
        int imgToday = 0, imgMonth = 0;
        double costMonth = 0;
        Map<String, Integer> products = new HashMap<>(), models = new HashMap<>(), styles = new HashMap<>();
        for (Map<String, Object> g : Store.list("gallery")) {
            String at = str(g.get("createdAt"), "");
            if (at.startsWith(today)) imgToday++;
            if (at.startsWith(m)) { imgMonth++; costMonth += num(g.get("cost")); }
            products.merge(str(g.get("productId"), ""), 1, Integer::sum);
            if (!str(g.get("modelId"), "").isEmpty()) models.merge(str(g.get("modelId"), ""), 1, Integer::sum);
            styles.merge(str(g.get("style"), ""), 1, Integer::sum);
        }
        for (Map<String, Object> c : Store.list("costs")) if (str(c.get("createdAt"), "").startsWith(m)) costMonth += num(c.get("cost"));
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("imagesToday", imgToday);
        out.put("imagesMonth", imgMonth);
        out.put("costMonth", costMonth);
        out.put("costLimit", num(Store.settings().getOrDefault("monthlyCostLimit", 0)));
        out.put("topProducts", top(products, "products"));
        out.put("topModels", top(models, "models"));
        out.put("topStyles", top(styles, "styles"));
        return out;
    }

    @SuppressWarnings("unchecked")
    static List<Object> top(Map<String, Integer> counts, String list) {
        List<Object> out = new ArrayList<>();
        counts.entrySet().stream().sorted((a, b) -> b.getValue() - a.getValue()).limit(5).forEach(e -> {
            String name = e.getKey();
            if ("products".equals(list)) { Map<String, Object> p = Store.find("products", e.getKey()); if (p != null) name = (String) p.get("name"); }
            else if ("styles".equals(list)) name = str(pick("styles", e.getKey()).get("name"), name);
            else for (Object mo : Store.models()) if (((Map<String, Object>) mo).get("id").equals(e.getKey())) name = (String) ((Map<String, Object>) mo).get("name");
            out.add(Map.of("name", name.isEmpty() ? "(none)" : name, "count", e.getValue()));
        });
        return out;
    }

    // ---------- the image engine (Pollinations) ----------

    /** Sends a prompt (+ reference images) to Pollinations and returns the image bytes. Swap this to use another service. */
    @SuppressWarnings("unchecked")
    static byte[] callEngine(Map<String, Object> engine, String prompt, List<Path> refs, int w, int h, long seed) throws Exception {
        String key = str(Store.settings().get("pollinationsKey"), "");
        if (key.isEmpty()) throw new HttpError(400, "No Pollinations key yet. An admin can add it in Admin > Settings, or use Copy prompt instead.");
        String model = str(engine.get("model"), "");
        int maxRefs = (int) num(engine.getOrDefault("maxRefs", 10));
        if (refs.size() > maxRefs) refs = refs.subList(0, maxRefs);
        String size = "openai".equals(engine.get("sizeRule"))
                ? (w == h ? "1024x1024" : (w < h ? "1024x1536" : "1536x1024"))
                : w + "x" + h;

        HttpRequest.Builder req = HttpRequest.newBuilder().timeout(Duration.ofMinutes(4)).header("Authorization", "Bearer " + key);
        if (refs.isEmpty()) {
            Map<String, Object> b = new LinkedHashMap<>();
            b.put("prompt", prompt);
            b.put("model", model);
            b.put("size", size);
            b.put("response_format", "b64_json");
            if (seed >= 0) b.put("seed", seed);
            req.uri(URI.create(POLLINATIONS + "/v1/images/generations")).header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(Json.stringify(b)));
        } else {
            String boundary = "----monsa" + randomId(12);
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            Map<String, String> fields = new LinkedHashMap<>();
            fields.put("prompt", prompt);
            fields.put("model", model);
            fields.put("size", size);
            fields.put("response_format", "b64_json");
            if (seed >= 0) fields.put("seed", String.valueOf(seed));
            for (Map.Entry<String, String> f : fields.entrySet())
                out.write(("--" + boundary + "\r\nContent-Disposition: form-data; name=\"" + f.getKey() + "\"\r\n\r\n" + f.getValue() + "\r\n").getBytes(StandardCharsets.UTF_8));
            for (Path p : refs) {
                String name = p.getFileName().toString();
                out.write(("--" + boundary + "\r\nContent-Disposition: form-data; name=\"image\"; filename=\"" + name + "\"\r\nContent-Type: " + mime(name) + "\r\n\r\n").getBytes(StandardCharsets.UTF_8));
                out.write(Files.readAllBytes(p));
                out.write("\r\n".getBytes(StandardCharsets.UTF_8));
            }
            out.write(("--" + boundary + "--\r\n").getBytes(StandardCharsets.UTF_8));
            req.uri(URI.create(POLLINATIONS + "/v1/images/edits")).header("Content-Type", "multipart/form-data; boundary=" + boundary)
                    .POST(HttpRequest.BodyPublishers.ofByteArray(out.toByteArray()));
        }
        HttpResponse<String> res = http.send(req.build(), HttpResponse.BodyHandlers.ofString());
        if (res.statusCode() != 200) {
            String msg = res.body();
            try {
                Object err = ((Map<String, Object>) Json.parse(res.body())).get("error");
                msg = err instanceof Map ? str(((Map<String, Object>) err).get("message"), msg) : str(err, msg);
            } catch (Exception ignored) {}
            throw new HttpError(502, "The AI service said: " + msg);
        }
        Map<String, Object> json = (Map<String, Object>) Json.parse(res.body());
        Map<String, Object> first = (Map<String, Object>) listOf(json.get("data")).get(0);
        if (first.get("b64_json") != null) return Base64.getDecoder().decode((String) first.get("b64_json"));
        HttpResponse<byte[]> img = http.send(HttpRequest.newBuilder(URI.create((String) first.get("url"))).build(), HttpResponse.BodyHandlers.ofByteArray());
        return img.body();
    }

    // ---------- files ----------

    static String saveDataUrl(String dataUrl, String nameNoExt) throws IOException {
        int comma = dataUrl.indexOf(',');
        if (!dataUrl.startsWith("data:image/") || comma < 0) throw new HttpError(400, "That file is not an image.");
        String head = dataUrl.substring(0, comma);
        String ext = head.contains("png") ? ".png" : head.contains("webp") ? ".webp" : ".jpg";
        String rel = nameNoExt + ext;
        Files.write(STORAGE.resolve(rel), Base64.getDecoder().decode(dataUrl.substring(comma + 1)));
        return rel;
    }

    static String saveBytes(byte[] img, String nameNoExt) throws IOException {
        String ext = (img.length > 3 && (img[0] & 0xff) == 0x89 && img[1] == 'P') ? ".png"
                : (img.length > 11 && img[8] == 'W' && img[9] == 'E') ? ".webp" : ".jpg";
        String rel = nameNoExt + ext;
        Files.write(STORAGE.resolve(rel), img);
        return rel;
    }

    static Path safeStorage(String rel) {
        Path p = STORAGE.resolve(rel).normalize();
        if (!p.startsWith(STORAGE) || !Files.exists(p)) throw new HttpError(404, "File not found: " + rel);
        return p;
    }

    static void serveStorage(HttpExchange ex, String rel) throws IOException {
        requireUser(ex);
        Path p = safeStorage(URLDecoder.decode(rel, StandardCharsets.UTF_8));
        sendFile(ex, p, "private, max-age=86400");
    }

    static void serveStatic(HttpExchange ex, String path) throws IOException {
        if (path.equals("/") || !path.contains(".")) path = "/index.html";
        Path p = PUBLIC.resolve(path.substring(1)).normalize();
        if (!p.startsWith(PUBLIC) || !Files.exists(p)) { sendJson(ex, 404, Map.of("error", "Not found")); return; }
        sendFile(ex, p, "no-cache");
    }

    static void sendFile(HttpExchange ex, Path p, String cache) throws IOException {
        byte[] bytes = Files.readAllBytes(p);
        ex.getResponseHeaders().add("Content-Type", mime(p.toString()));
        ex.getResponseHeaders().add("Cache-Control", cache);
        ex.sendResponseHeaders(200, bytes.length);
        ex.getResponseBody().write(bytes);
    }

    static String mime(String name) {
        String n = name.toLowerCase();
        if (n.endsWith(".html")) return "text/html; charset=utf-8";
        if (n.endsWith(".js")) return "text/javascript; charset=utf-8";
        if (n.endsWith(".css")) return "text/css; charset=utf-8";
        if (n.endsWith(".png")) return "image/png";
        if (n.endsWith(".webp")) return "image/webp";
        if (n.endsWith(".svg")) return "image/svg+xml";
        if (n.endsWith(".json")) return "application/json";
        return "image/jpeg";
    }

    static String ext(String f) { int i = f.lastIndexOf('.'); return i < 0 ? ".jpg" : f.substring(i); }

    // ---------- small helpers ----------

    static void log(Map<String, Object> user, String what) {
        Map<String, Object> e = new LinkedHashMap<>();
        e.put("at", Instant.now().toString());
        e.put("user", user.get("name") + " (" + user.get("email") + ")");
        e.put("what", what);
        synchronized (Store.class) {
            List<Map<String, Object>> l = Store.list("log");
            l.add(0, e);
            if (l.size() > 2000) l = new ArrayList<>(l.subList(0, 2000));
            Store.save("log", l);
        }
    }

    @SuppressWarnings("unchecked")
    static Map<String, Object> body(HttpExchange ex) throws IOException {
        String s = new String(ex.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
        if (s.isBlank()) return new LinkedHashMap<>();
        Object o = Json.parse(s);
        if (!(o instanceof Map)) throw new HttpError(400, "Bad request.");
        return (Map<String, Object>) o;
    }

    static Map<String, String> query(HttpExchange ex) {
        Map<String, String> q = new HashMap<>();
        String raw = ex.getRequestURI().getRawQuery();
        if (raw == null) return q;
        for (String kv : raw.split("&")) {
            int i = kv.indexOf('=');
            if (i > 0) q.put(URLDecoder.decode(kv.substring(0, i), StandardCharsets.UTF_8), URLDecoder.decode(kv.substring(i + 1), StandardCharsets.UTF_8));
        }
        return q;
    }

    static String cookie(HttpExchange ex, String name) {
        for (String h : ex.getRequestHeaders().getOrDefault("Cookie", List.of()))
            for (String c : h.split(";")) {
                String[] kv = c.trim().split("=", 2);
                if (kv.length == 2 && kv[0].equals(name)) return kv[1];
            }
        return null;
    }

    static void ok(HttpExchange ex) { sendJson(ex, 200, Map.of("ok", true)); }

    static void sendJson(HttpExchange ex, int status, Object o) {
        try {
            byte[] b = Json.stringify(o).getBytes(StandardCharsets.UTF_8);
            ex.getResponseHeaders().set("Content-Type", "application/json; charset=utf-8");
            ex.sendResponseHeaders(status, b.length);
            ex.getResponseBody().write(b);
        } catch (IOException ignored) {}
    }

    static String fill(String template, Map<String, String> vars) {
        for (Map.Entry<String, String> e : vars.entrySet()) template = template.replace("{" + e.getKey() + "}", e.getValue());
        return template;
    }

    static String randomId(int bytes) {
        byte[] b = new byte[bytes];
        random.nextBytes(b);
        return HexFormat.of().formatHex(b);
    }

    static String str(Object o, String def) { return o == null ? def : o.toString(); }

    static double num(Object o) {
        if (o instanceof Number n) return n.doubleValue();
        try { return Double.parseDouble(String.valueOf(o)); } catch (Exception e) { return 0; }
    }

    @SuppressWarnings("unchecked")
    static List<Object> listOf(Object o) { return o instanceof List ? (List<Object>) o : new ArrayList<>(); }
}

/** Data kept as simple JSON files in the data/ folder. Defaults come from config/. */
class Store {
    static Object read(String name, Object fallback) {
        try {
            Path p = Server.DATA.resolve(name + ".json");
            if (!Files.exists(p)) p = Server.CONFIG.resolve(name + ".json");
            if (!Files.exists(p)) return fallback;
            return Json.parse(Files.readString(p, StandardCharsets.UTF_8));
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    static synchronized void save(String name, Object value) {
        try {
            Path tmp = Server.DATA.resolve(name + ".json.tmp");
            Files.writeString(tmp, Json.stringify(value, true), StandardCharsets.UTF_8);
            Files.move(tmp, Server.DATA.resolve(name + ".json"), StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    @SuppressWarnings("unchecked")
    static synchronized List<Map<String, Object>> list(String name) { return (List<Map<String, Object>>) read(name, new ArrayList<>()); }

    @SuppressWarnings("unchecked")
    static synchronized Map<String, Object> options() { return (Map<String, Object>) read("options", new LinkedHashMap<>()); }

    @SuppressWarnings("unchecked")
    static synchronized Map<String, Object> prompts() { return (Map<String, Object>) read("prompts", new LinkedHashMap<>()); }

    @SuppressWarnings("unchecked")
    static synchronized Map<String, Object> settings() { return (Map<String, Object>) read("settings", new LinkedHashMap<>()); }

    @SuppressWarnings("unchecked")
    static synchronized List<Object> models() { return (List<Object>) read("models", new ArrayList<>()); }

    static synchronized Map<String, Object> find(String name, String id) {
        for (Map<String, Object> m : list(name)) if (id.equals(m.get("id"))) return m;
        return null;
    }

    static synchronized void add(String name, Map<String, Object> item) {
        List<Map<String, Object>> l = list(name);
        l.add(item);
        save(name, l);
    }

    static synchronized void remove(String name, String id) {
        List<Map<String, Object>> l = list(name);
        l.removeIf(m -> id.equals(m.get("id")));
        save(name, l);
    }
}

/** A tiny JSON reader/writer so we don't need any extra libraries. */
class Json {
    static Object parse(String s) { return new Json(s).value(); }

    static String stringify(Object o) { return stringify(o, false); }

    static String stringify(Object o, boolean pretty) {
        StringBuilder sb = new StringBuilder();
        write(sb, o, pretty, "");
        return sb.toString();
    }

    private final String s;
    private int i;

    private Json(String s) { this.s = s; }

    private Object value() {
        ws();
        if (i >= s.length()) throw new IllegalArgumentException("Unexpected end of JSON");
        char c = s.charAt(i);
        if (c == '{') {
            Map<String, Object> m = new LinkedHashMap<>();
            i++; ws();
            if (s.charAt(i) == '}') { i++; return m; }
            while (true) {
                ws(); String k = string(); ws(); expect(':');
                m.put(k, value()); ws();
                if (s.charAt(i) == ',') { i++; continue; }
                expect('}'); return m;
            }
        }
        if (c == '[') {
            List<Object> l = new ArrayList<>();
            i++; ws();
            if (s.charAt(i) == ']') { i++; return l; }
            while (true) {
                l.add(value()); ws();
                if (s.charAt(i) == ',') { i++; continue; }
                expect(']'); return l;
            }
        }
        if (c == '"') return string();
        if (s.startsWith("true", i)) { i += 4; return true; }
        if (s.startsWith("false", i)) { i += 5; return false; }
        if (s.startsWith("null", i)) { i += 4; return null; }
        int start = i;
        while (i < s.length() && "+-0123456789.eE".indexOf(s.charAt(i)) >= 0) i++;
        String n = s.substring(start, i);
        if (n.isEmpty()) throw new IllegalArgumentException("Bad JSON at " + start);
        if (n.contains(".") || n.contains("e") || n.contains("E")) return Double.parseDouble(n);
        return Long.parseLong(n);
    }

    private String string() {
        expect('"');
        StringBuilder sb = new StringBuilder();
        while (true) {
            char c = s.charAt(i++);
            if (c == '"') return sb.toString();
            if (c == '\\') {
                char e = s.charAt(i++);
                switch (e) {
                    case 'n' -> sb.append('\n');
                    case 't' -> sb.append('\t');
                    case 'r' -> sb.append('\r');
                    case 'b' -> sb.append('\b');
                    case 'f' -> sb.append('\f');
                    case 'u' -> { sb.append((char) Integer.parseInt(s.substring(i, i + 4), 16)); i += 4; }
                    default -> sb.append(e);
                }
            } else sb.append(c);
        }
    }

    private void ws() { while (i < s.length() && Character.isWhitespace(s.charAt(i))) i++; }

    private void expect(char c) {
        if (i >= s.length() || s.charAt(i) != c) throw new IllegalArgumentException("Expected '" + c + "' at " + i);
        i++;
    }

    @SuppressWarnings("unchecked")
    private static void write(StringBuilder sb, Object o, boolean pretty, String indent) {
        String nl = pretty ? "\n" : "", in2 = pretty ? indent + "  " : "";
        if (o == null) sb.append("null");
        else if (o instanceof String str) quote(sb, str);
        else if (o instanceof Boolean) sb.append(o);
        else if (o instanceof Number n) {
            double d = n.doubleValue();
            sb.append(d == Math.rint(d) && !Double.isInfinite(d) && Math.abs(d) < 1e15 ? String.valueOf((long) d) : String.valueOf(d));
        } else if (o instanceof Map<?, ?> m) {
            if (m.isEmpty()) { sb.append("{}"); return; }
            sb.append('{').append(nl);
            int k = 0;
            for (Map.Entry<?, ?> e : m.entrySet()) {
                if (k++ > 0) sb.append(',').append(nl);
                sb.append(in2);
                quote(sb, String.valueOf(e.getKey()));
                sb.append(pretty ? ": " : ":");
                write(sb, e.getValue(), pretty, in2);
            }
            sb.append(nl).append(indent).append('}');
        } else if (o instanceof Collection<?> c) {
            if (c.isEmpty()) { sb.append("[]"); return; }
            sb.append('[').append(nl);
            int k = 0;
            for (Object v : c) {
                if (k++ > 0) sb.append(',').append(nl);
                sb.append(in2);
                write(sb, v, pretty, in2);
            }
            sb.append(nl).append(indent).append(']');
        } else quote(sb, o.toString());
    }

    private static void quote(StringBuilder sb, String s) {
        sb.append('"');
        for (char c : s.toCharArray()) {
            switch (c) {
                case '"' -> sb.append("\\\"");
                case '\\' -> sb.append("\\\\");
                case '\n' -> sb.append("\\n");
                case '\r' -> sb.append("\\r");
                case '\t' -> sb.append("\\t");
                default -> { if (c < 0x20) sb.append(String.format("\\u%04x", (int) c)); else sb.append(c); }
            }
        }
        sb.append('"');
    }
}
