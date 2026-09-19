path = r"D:\yingce\open-ai-canvas-main\web\src\pages\canvas\list-mode-generator.ts"
with open(path, "r", encoding="utf-8") as f:
    content = f.read()

# Fix import
content = content.replace(
    'import { resolveCanvasGenerationModel } from "@/lib/canvas/canvas-project-generation";',
    'import { buildGenerationConfig } from "@/lib/canvas/canvas-project-generation";'
)

# Fix config building - use buildGenerationConfig instead of resolveCanvasGenerationModel
content = content.replace(
    '        const model = resolveCanvasGenerationModel(config, undefined, "text");\n        const listConfig = { ...config, model };',
    '        const listConfig = buildGenerationConfig(config, sourceNode, "text");'
)

with open(path, "w", encoding="utf-8") as f:
    f.write(content)
print("done")
