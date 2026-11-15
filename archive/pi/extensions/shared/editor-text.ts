export function appendEditorText(
  currentText: string,
  textToAppend: string,
): string {
  if (!currentText.trim()) return textToAppend;
  const separator = currentText.endsWith("\n") ? "\n" : "\n\n";
  return `${currentText}${separator}${textToAppend}`;
}
