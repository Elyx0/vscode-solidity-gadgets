// src/extension.ts
import * as vscode from 'vscode';

function generateShortId(): string {
  return Math.random().toString(36).substring(2, 8);
}

export function activate(context: vscode.ExtensionContext) {
  let disposable = vscode.commands.registerCommand('extension.addDebugTrace', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const document = editor.document;
    const selection = editor.selection;
    let selectedText = document.getText(selection).trim();

    if (!selectedText) {
      const wordRange = document.getWordRangeAtPosition(selection.active);
      if (wordRange) {
        selectedText = document.getText(wordRange).trim();
      }
    }

    if (!selectedText) return vscode.window.showErrorMessage("No variable selected.");

    const debugVarName = `Debug${selectedText.replace(/\./g, '')}`;
    const debugId = generateShortId();

    const fullText = document.getText();
    const startOffset = document.offsetAt(selection.start);
    const assemblyStart = findAssemblyStart(fullText, startOffset);
    const assemblyEnd = findMatchingBrace(fullText, assemblyStart);

    if (assemblyStart === -1 || assemblyEnd === -1) {
      return vscode.window.showErrorMessage("No enclosing assembly block found.");
    }

    const asmStartPos = document.positionAt(assemblyStart);
    const asmEndPos = document.positionAt(assemblyEnd);

    const format = await vscode.window.showQuickPick(["uint", "hex", "bytes"], {
      placeHolder: "Select the format for logging this variable"
    });
    if (!format) return;

    let debugIndent = '';
    if (asmStartPos.line > 0) {
      const lineAbove = document.lineAt(asmStartPos.line - 1).text;
      debugIndent = lineAbove.trim() === ''
        ? document.lineAt(asmStartPos.line).text.match(/^\s*/)?.[0] || ''
        : lineAbove.match(/^\s*/)?.[0] || '';
    } else {
      debugIndent = document.lineAt(asmStartPos.line).text.match(/^\s*/)?.[0] || '';
    }

    const debugVarInsertPos = asmStartPos.line > 0
      ? asmStartPos.translate(-1, 0)
      : new vscode.Position(0, 0);

    const insertDebugVar = new vscode.TextEdit(
      new vscode.Range(debugVarInsertPos, debugVarInsertPos),
      `${debugIndent}uint ${debugVarName}; // [gadgets-debug-var:${debugId}]\n`
    );

    const selectedLine = selection.start.line;
    const referenceIndent = document.lineAt(selectedLine).text.match(/^\s*/)?.[0] || '';
    const asmInsertPos = new vscode.Position(selectedLine + 1, 0);
    const assignmentLine = `${referenceIndent}${debugVarName} := ${selectedText}; // [gadgets-debug-assign:${debugId}]\n`;
    const insertAssignment = new vscode.TextEdit(
      new vscode.Range(asmInsertPos, asmInsertPos),
      assignmentLine
    );

    // Log position: just after the assembly's closing brace
    const asmEndLineNum = asmEndPos.line;
    const asmEndLine = document.lineAt(asmEndLineNum);
    const closingIndent = asmEndLine.text.match(/^\s*/)?.[0] || '';
    const logPos = new vscode.Position(asmEndLineNum + 1, 0);

    let logContent = "\n";
    if (format === "bytes") {
      logContent += `${closingIndent}console.log(\"${debugVarName}:\"); // [gadgets-debug-log:${debugId}]\n`;
      logContent += `${closingIndent}console.logBytes(${debugVarName}); // [gadgets-debug-log:${debugId}]\n`;
    } else if (format === "hex") {
      logContent += `${closingIndent}console.log(\"${debugVarName} %x\", ${debugVarName}); // [gadgets-debug-log:${debugId}]\n`;
    } else {
      logContent += `${closingIndent}console.log(\"${debugVarName} %d\", ${debugVarName}); // [gadgets-debug-log:${debugId}]\n`;
    }

    const insertLog = new vscode.TextEdit(
      new vscode.Range(logPos, logPos),
      logContent
    );

    const edit = new vscode.WorkspaceEdit();
    edit.set(document.uri, [insertDebugVar, insertAssignment, insertLog]);
    await vscode.workspace.applyEdit(edit);
  });

  let toggleCommentFromCursor = vscode.commands.registerCommand('extension.toggleGadgetBlockAtCursor', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    const doc = editor.document;
    const cursor = editor.selection.active;
    const lines = doc.getText().split('\n');

    const currentLine = lines[cursor.line];
    const match = currentLine.match(/\[gadgets-debug-(?:var|assign|log):([a-z0-9]+)\]/);
    if (!match) return vscode.window.showInformationMessage("No gadget debug tag found on current line.");
    const id = match[1];

    const edit = new vscode.WorkspaceEdit();
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(`[gadgets-debug-var:${id}]`) ||
          lines[i].includes(`[gadgets-debug-assign:${id}]`) ||
          lines[i].includes(`[gadgets-debug-log:${id}]`)) {
        const line = lines[i];
        const isCommented = line.trimStart().startsWith('//');
        const range = new vscode.Range(new vscode.Position(i, 0), new vscode.Position(i, line.length));
        const newText = isCommented ? line.replace(/^\s*\/\/\s?/, '') : `// ${line}`;
        edit.replace(doc.uri, range, newText);
      }
    }

    await vscode.workspace.applyEdit(edit);
  });

  let removeGadgetTraceAtCursor = vscode.commands.registerCommand('extension.removeGadgetBlockAtCursor', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    const doc = editor.document;
    const cursor = editor.selection.active;
    const lines = doc.getText().split('\n');

    const currentLine = lines[cursor.line];
    const match = currentLine.match(/\[gadgets-debug-(?:var|assign|log):([a-z0-9]+)\]/);
    if (!match) return vscode.window.showInformationMessage("No gadget debug tag found on current line.");
    const id = match[1];

    const edit = new vscode.WorkspaceEdit();
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(`[gadgets-debug-var:${id}]`) ||
          lines[i].includes(`[gadgets-debug-assign:${id}]`) ||
          lines[i].includes(`[gadgets-debug-log:${id}]`)) {
        const line = lines[i];
        const range = new vscode.Range(new vscode.Position(i, 0), new vscode.Position(i, line.length));
        edit.delete(doc.uri, range);
      }
    }

    await vscode.workspace.applyEdit(edit);
  });

  vscode.window.onDidChangeTextEditorSelection(event => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const line = editor.document.lineAt(editor.selection.active.line).text;
    const isGadget = /\[gadgets-debug-(var|assign|log):/.test(line);
    vscode.commands.executeCommand('setContext', 'gadgetsDebugLine', isGadget);
  });

  context.subscriptions.push(disposable);
  context.subscriptions.push(toggleCommentFromCursor);
  context.subscriptions.push(removeGadgetTraceAtCursor);
}

export function deactivate() { }

function findAssemblyStart(text: string, offset: number): number {
  const regex = /assembly(\s*\([^)]*\))?\s*\{/g;
  let match: RegExpExecArray | null;
  let lastValid = -1;
  while ((match = regex.exec(text)) !== null) {
    if (match.index < offset) {
      lastValid = match.index;
    } else {
      break;
    }
  }
  return lastValid;
}

function findMatchingBrace(text: string, startIndex: number): number {
  let depth = 0;
  let i = startIndex;

  // Skip to first `{`
  while (i < text.length && text[i] !== '{') i++;
  if (text[i] !== '{') return -1;

  for (; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}
