path = r"D:\yingce\open-ai-canvas-main\web\src\pages\canvas\list-mode-generator.ts"
with open(path, "r", encoding="utf-8") as f:
    content = f.read()

old = '''        const listConfig = buildGenerationConfig(config, sourceNode, "text");'''
new = '''        // Force text model: strip node.metadata.model so buildGenerationConfig uses config.textModel
        const sourceNodeForConfig = { ...sourceNode, metadata: { ...(sourceNode.metadata || {}), model: undefined } };
        let listConfig = buildGenerationConfig(config, sourceNodeForConfig, "text");
        // Explicitly set model to the configured text model
        if (config.textModel) {
            listConfig = { ...listConfig, model: config.textModel };
        }'''
content = content.replace(old, new, 1)

with open(path, "w", encoding="utf-8") as f:
    f.write(content)
print("done")
