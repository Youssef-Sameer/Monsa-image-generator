// Monsa Studio — default settings. The Admin page can change all of these (changes are saved in your browser).
// "Reset to default" in Admin brings back what is written here.
window.DEFAULTS = {
// ----- styles, poses, colours, sizes, AI engines, feature switches -----
options: {
  "features": {
    "onModel": true,
    "productOnly": true,
    "oneClickGenerate": true,
    "copyPrompt": true,
    "editText": true,
    "moreLikeThis": true,
    "zipDownload": true
  },
  "productTypes": [
    { "id": "bag", "name": "Bag", "enabled": true, "prompt": "The product is a handmade bag. It must be held or carried naturally: correct hand grip, realistic strap, handle and chain behaviour, true size relative to the body." },
    { "id": "accessory", "name": "Accessory", "enabled": true, "prompt": "The product is a handmade accessory (for example earrings). Show it clearly and in sharp focus; when worn, place it correctly and at true scale." },
    { "id": "clothing", "name": "Clothing", "enabled": true, "prompt": "The product is a handmade clothing piece. Keep its exact cut, length, fit, pattern, embroidery and colours." }
  ],
  "styles": [
    { "id": "studio", "name": "Studio", "enabled": true, "usesBackground": true, "usesScene": false, "prompt": "Professional studio fashion photo on a solid seamless backdrop of {background}. Soft, even, diffused light with a subtle natural shadow. Clean, minimal, high-end e-commerce look." },
    { "id": "lifestyle", "name": "Lifestyle", "enabled": true, "usesBackground": false, "usesScene": true, "prompt": "Natural lifestyle photo with a casual, real-photo feel, as if shot on a good camera by a friend. Setting: {scene}. Natural daylight, soft background blur." }
  ],
  "backgrounds": [
    { "id": "deep-blue", "name": "Deep blue", "color": "#1f3a8a", "enabled": true, "default": true },
    { "id": "beige", "name": "Beige", "color": "#e8dcc8", "enabled": true, "default": false },
    { "id": "brick-red", "name": "Brick red", "color": "#a23b2a", "enabled": true, "default": false },
    { "id": "white", "name": "White", "color": "#ffffff", "enabled": true, "default": false },
    { "id": "sage", "name": "Sage green", "color": "#9caf88", "enabled": true, "default": false }
  ],
  "scenes": [
    { "id": "home", "name": "Home", "enabled": true, "prompt": "a bright, cosy home interior with warm wood and plants" },
    { "id": "cafe", "name": "Cafe", "enabled": true, "prompt": "a stylish cafe table by a window" },
    { "id": "street", "name": "Street", "enabled": true, "prompt": "a sunny city street with warm-toned old buildings" },
    { "id": "pool", "name": "By the pool", "enabled": true, "prompt": "beside a calm turquoise swimming pool on a sunny day" },
    { "id": "beach", "name": "Beach", "enabled": true, "prompt": "a soft sandy beach with gentle sea in the background" }
  ],
  "poses": [
    { "id": "front", "name": "Standing front", "enabled": true, "prompt": "standing facing the camera, relaxed and natural" },
    { "id": "back", "name": "Back view, over the shoulder", "enabled": true, "prompt": "seen from behind, looking back over her shoulder" },
    { "id": "stool", "name": "Seated on a stool", "enabled": true, "prompt": "seated on a simple black stool, relaxed posture" },
    { "id": "walking", "name": "Walking", "enabled": true, "prompt": "walking mid-step, natural movement" },
    { "id": "closeup", "name": "Close-up holding product", "enabled": true, "prompt": "close-up of her hands holding the product toward the camera" },
    { "id": "surprise", "name": "Surprise me", "enabled": true, "prompt": "a natural, flattering editorial pose that best shows the product" }
  ],
  "framings": [
    { "id": "full", "name": "Full body", "enabled": true, "prompt": "full-body shot, head to toe" },
    { "id": "waist", "name": "Waist-up", "enabled": true, "prompt": "waist-up shot" },
    { "id": "cropped", "name": "Cropped (no face)", "enabled": true, "prompt": "cropped shot without the face, the product is the hero of the frame" }
  ],
  "outfits": [
    { "id": "auto", "name": "Match automatically", "enabled": true, "prompt": "a simple neutral outfit that complements the product without competing with it" },
    { "id": "tee-jeans", "name": "Cream tee + light jeans", "enabled": true, "prompt": "a cream oversized t-shirt and light-wash jeans" },
    { "id": "linen", "name": "Sage linen trousers + cream top", "enabled": true, "prompt": "sage-green linen wide-leg trousers with a sleeveless cream top" },
    { "id": "white-tee", "name": "Plain white tee", "enabled": true, "prompt": "a plain white t-shirt and neutral trousers" }
  ],
  "sizes": [
    { "id": "post", "name": "Instagram post 4:5", "ratio": "4:5", "width": 1024, "height": 1280, "enabled": true, "default": true },
    { "id": "story", "name": "Story / Reel 9:16", "ratio": "9:16", "width": 864, "height": 1536, "enabled": true, "default": false },
    { "id": "square", "name": "Square 1:1", "ratio": "1:1", "width": 1024, "height": 1024, "enabled": true, "default": false }
  ],
  "engines": [
    { "id": "klein", "name": "FLUX.2 Klein (free key, fast)", "model": "black-forest-labs/flux.2-klein-4b", "maxRefs": 10, "sizeRule": "exact", "costPerImage": 0.005, "enabled": true, "default": true },
    { "id": "gpt-mini", "name": "GPT Image Mini (free key)", "model": "openai/gpt-image-1-mini", "maxRefs": 16, "sizeRule": "openai", "costPerImage": 0.02, "enabled": true, "default": false },
    { "id": "nano-banana", "name": "Nano Banana (needs paid pollen)", "model": "google/gemini-2.5-flash-image", "maxRefs": 3, "sizeRule": "exact", "costPerImage": 0.04, "enabled": false, "default": false },
    { "id": "nano-banana-2", "name": "Nano Banana 2 (needs paid pollen)", "model": "google/gemini-3.1-flash-image", "maxRefs": 14, "sizeRule": "exact", "costPerImage": 0.08, "enabled": false, "default": false },
    { "id": "nano-banana-pro", "name": "Nano Banana Pro (needs paid pollen)", "model": "google/gemini-3-pro-image", "maxRefs": 14, "sizeRule": "exact", "costPerImage": 0.15, "enabled": false, "default": false }
  ]
},
// ----- all wording sent to the AI. Words in {curly brackets} are filled in by the app -----
prompts: {
  "productOnly": "Create a professional product photograph of the {product_type} shown in the product reference image(s). No person in the picture. The product stands or lies naturally, centred, sharp and well lit.",
  "onModel": "Create a professional fashion photograph of the model shown in the model reference image(s) with the {product_type} shown in the product reference image(s). Keep the model exactly the same person: same face, hair, skin tone and body. Pose: {pose}. Framing: {framing}. She wears {outfit}. Natural, calm expression.",
  "clothingOnModel": "Create a professional fashion photograph of the model shown in the model reference image(s) WEARING the garment shown in the product reference image(s). Keep the model exactly the same person: same face, hair, skin tone and body. The garment must fit her naturally. Rest of the outfit: {outfit}. Pose: {pose}. Framing: {framing}. Natural, calm expression.",
  "references": "Reference images: the first {product_count} image(s) show the product{model_part}.",
  "accuracy": "PRODUCT ACCURACY (critical): this is a handmade product. Keep it EXACTLY as in the product photos: same shape, size relative to the body, colours, crochet/raffia/fabric texture, embroidery pattern, print, handles, chain and clasp details. Do NOT add logos, text, letters or extra decorations to the product. The product must be clearly visible, in sharp focus and true to colour. No text or watermark anywhere in the image.",
  "aspect": "Composition for a {ratio} image.",
  "modelSheet": "A model reference sheet of one fictional AI-generated fashion model, on a plain light-grey studio background, soft even light. Show the same woman four times side by side: front view full body, side view full body, back view full body, and a face close-up. Simple neutral fitted clothing. Description: {description}. Photorealistic, consistent identity across all four views, no text.",
  "edit": "Edit the first reference image: {instruction}. Change only what is asked. Keep everything else the same, especially the product (shape, colours, texture, details) and the model's identity. No text or watermark.",
  "moreLikeThis": "Create a new variation in the same style, mood, lighting and composition as the last reference image, with a slightly different pose and angle."
},
// ----- starter models -----
models: [
  { "id": "model-a", "name": "Model A", "enabled": true, "default": true, "images": [], "description": "young Egyptian woman in her mid-20s, long dark hair, warm brown skin, natural minimal makeup, slim build, calm natural expression" },
  { "id": "model-b", "name": "Model B", "enabled": true, "default": false, "images": [], "description": "young Egyptian woman in her mid-20s wearing a neatly wrapped neutral beige hijab, modern modest style, warm light-brown skin, soft natural makeup, slim build, calm expression" },
  { "id": "model-c", "name": "Model C", "enabled": true, "default": false, "images": [], "description": "elegant Egyptian woman around 30 wearing a soft neutral hijab and a flowing cream linen abaya, warm skin, graceful posture, calm expression" }
]
};
