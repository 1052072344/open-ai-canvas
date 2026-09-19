path = r"D:\yingce\open-ai-canvas-main\web\src\pages\canvas\shared.tsx"
with open(path, "r", encoding="utf-8") as f:
    content = f.read()
content = content.replace(
    'onUploadReference={() => {}} onConnectStart={() => {}}',
    'onUploadReference={() => {}} onRemoveReference={() => {}} onConnectStart={() => {}}'
)
with open(path, "w", encoding="utf-8") as f:
    f.write(content)
print("done")
