path = r"D:\yingce\open-ai-canvas-main\web\src\pages\canvas\project.tsx"
with open(path, "r", encoding="utf-8") as f:
    content = f.read()

old_upload = '                        onUploadReference={(rowId, columnIndex, file) => { void handleUploadBatchReference(contentNode.id, rowId, columnIndex, file); }}'
new_upload = '''                        onUploadReference={(rowId, columnIndex, file) => { void handleUploadBatchReference(contentNode.id, rowId, columnIndex, file); }}
                        onRemoveReference={(rowId, columnIndex) => {
                            const table = nodesRef.current.find((n) => n.id === contentNode.id)?.metadata?.batchTable;
                            if (!table) return;
                            const row = table.rows.find((r) => r.id === rowId);
                            if (!row) return;
                            const newInputNodeIds = [...row.inputNodeIds];
                            newInputNodeIds[columnIndex] = "";
                            updateBatchRow(contentNode.id, rowId, { inputNodeIds: newInputNodeIds });
                        }}'''
content = content.replace(old_upload, new_upload, 1)

with open(path, "w", encoding="utf-8") as f:
    f.write(content)
print("done")
