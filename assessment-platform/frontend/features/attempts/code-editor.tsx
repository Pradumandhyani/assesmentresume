'use client';
import { useEffect, useState } from 'react';
import Editor, { loader, type OnMount } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import type { Language } from '@/services/attempt-api';
loader.config({ paths: { vs: '/monaco/vs' } });
const languages = { PYTHON: 'python', JAVA: 'java', CPP: 'cpp' } as const;
const emptyMarkers: editor.IMarkerData[] = [];
const snippets = {
  python: [
    {
      label: 'read-input',
      text: 'import sys\n\n${1:data} = sys.stdin.read().split()\n$0',
      detail: 'Read standard input',
    },
  ],
  java: [
    {
      label: 'main',
      text: 'public class Main {\n    public static void main(String[] args) throws Exception {\n        $0\n    }\n}',
      detail: 'Main entry point',
    },
  ],
  cpp: [
    {
      label: 'fast-io',
      text: 'std::ios::sync_with_stdio(false);\nstd::cin.tie(nullptr);\n$0',
      detail: 'Configure standard I/O',
    },
  ],
};
export function CodeEditor({
  questionId,
  language,
  source,
  onChange,
  onSave,
  readOnly,
  theme,
  fontSize,
  markers = emptyMarkers,
}: {
  questionId: string;
  language: Language;
  source: string;
  onChange: (value: string) => void;
  onSave: () => void;
  readOnly: boolean;
  theme: 'light' | 'dark';
  fontSize: number;
  markers?: editor.IMarkerData[];
}) {
  const [failure, setFailure] = useState(false);
  useEffect(() => {
    void loader.init().catch(() => setFailure(true));
  }, []);
  useEffect(() => {
    let cancelled = false;
    const providers: Array<{ dispose: () => void }> = [];
    void loader
      .init()
      .then((monaco) => {
        if (cancelled) return;
        for (const [id, entries] of Object.entries(snippets))
          providers.push(
            monaco.languages.registerCompletionItemProvider(id, {
              provideCompletionItems: (
                model: editor.ITextModel,
                position: { lineNumber: number; column: number },
              ) => {
                const word = model.getWordUntilPosition(position);
                const range = {
                  startLineNumber: position.lineNumber,
                  endLineNumber: position.lineNumber,
                  startColumn: word.startColumn,
                  endColumn: word.endColumn,
                };
                return {
                  suggestions: entries.map((s) => ({
                    label: s.label,
                    detail: s.detail,
                    insertText: s.text,
                    kind: monaco.languages.CompletionItemKind.Snippet,
                    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                    range,
                  })),
                };
              },
            }),
          );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      providers.forEach((p) => p.dispose());
    };
  }, []);
  const mount: OnMount = (instance, monaco) => {
    instance.addAction({
      id: 'save-draft',
      label: 'Save draft',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
      run: onSave,
    });
    instance.addAction({
      id: 'run-unavailable',
      label: 'Execution unavailable until Step 4',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],
      run: () => {
        document.getElementById('execution-unavailable')?.focus();
      },
    });
    instance.updateOptions({
      ariaLabel: `${language === 'CPP' ? 'C++' : language === 'JAVA' ? 'Java' : 'Python'} code editor`,
    });
  };
  useEffect(() => {
    let cancelled = false;
    void loader
      .init()
      .then((monaco) => {
        if (cancelled) return;
        const model = monaco.editor.getModel(
          monaco.Uri.parse(`assessment:///${questionId}/${languages[language]}`),
        );
        if (model) monaco.editor.setModelMarkers(model, 'assessment-judge', markers);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [questionId, language, markers]);
  if (failure)
    return (
      <div className="workspace-empty" role="alert">
        <h3>The code editor could not load</h3>
        <p>Check your connection and reload. Saved drafts remain on the server.</p>
      </div>
    );
  return (
    <Editor
      height="100%"
      path={`assessment:///${questionId}/${languages[language]}`}
      language={languages[language]}
      value={source}
      theme={theme === 'dark' ? 'vs-dark' : 'light'}
      onChange={(value) => onChange(value ?? '')}
      onMount={mount}
      loading={
        <div className="editor-loading">
          <span className="spin">◌</span> Preparing your editor…
        </div>
      }
      options={{
        ariaLabel: `${language === 'CPP' ? 'C++' : language === 'JAVA' ? 'Java' : 'Python'} code editor`,
        readOnly,
        fontSize,
        fontFamily: 'Consolas, "SFMono-Regular", monospace',
        lineNumbers: 'on',
        minimap: { enabled: false },
        automaticLayout: true,
        autoIndent: 'full',
        matchBrackets: 'always',
        autoClosingBrackets: 'always',
        quickSuggestions: true,
        wordBasedSuggestions: 'currentDocument',
        suggest: { showWords: true },
        tabSize: 4,
        insertSpaces: true,
        scrollBeyondLastLine: false,
        padding: { top: 20, bottom: 20 },
        accessibilitySupport: 'auto',
        fixedOverflowWidgets: true,
        renderLineHighlight: 'line',
        bracketPairColorization: { enabled: true },
      }}
    />
  );
}
