import type * as Monaco from 'monaco-editor'

// Ngôn ngữ CloudWatch Logs Insights cho Monaco (Mốc 2 việc 2.3).
//
// VÌ SAO CẦN. Monaco không biết cú pháp Insights, nên mặc định nó tô câu lệnh như
// văn bản thường: `stats`, `filter`, `bin()` chìm vào nhau và người dùng phải tự
// đếm dấu `|`. Một tokenizer 40 dòng trả lại đúng thứ người ta cần thấy — RANH
// GIỚI giữa các lệnh và TÊN TRƯỜNG.
//
// KHÔNG phải một parser. Nó chỉ tô màu; mọi suy luận về ngữ nghĩa (câu có hợp lệ
// không, có tốn tiền không) nằm ở sidecar, nơi có thẩm quyền. Tokenizer sai một
// chữ chỉ làm màu sai — nó không bao giờ chặn hay cho chạy một lệnh.
//
// GỢI Ý TRƯỜNG lấy từ kết quả ĐÃ CHẠY (`fieldsProvider`), nên lần thứ hai gõ
// `| filter ` đã có tên cột thật để chọn thay vì phải nhớ.

export const INSIGHTS_LANGUAGE_ID = 'awog-insights'

let registered = false

/** Lệnh của Insights — đủ để tô màu; danh sách này KHÔNG phải allowlist. */
const COMMANDS = [
  'fields',
  'filter',
  'stats',
  'sort',
  'limit',
  'parse',
  'display',
  'dedup',
  'unnest',
]

const FUNCTIONS = [
  'count',
  'sum',
  'avg',
  'min',
  'max',
  'pct',
  'stddev',
  'concat',
  'strlen',
  'trim',
  'upper',
  'lower',
  'isempty',
  'isblank',
  'ispresent',
  'isnumeric',
  'abs',
  'ceil',
  'floor',
  'round',
  'sqrt',
  'bin',
  'datefloor',
  'dateceil',
  'fromMillis',
  'toMillis',
  'regexp_extract',
  'regexp_replace',
  'replace',
  'substr',
  'coalesce',
  'if',
  'earliest',
  'latest',
  'sortsFirst',
  'sortsLast',
]

/** Cột dựng sẵn của CloudWatch — luôn có mặt, khác với cột do `parse` sinh ra. */
const BUILTIN_FIELDS = [
  '@timestamp',
  '@message',
  '@logStream',
  '@log',
  '@logGroup',
  '@ptr',
  '@ingestionTime',
  '@initDuration',
  '@duration',
  '@maxMemoryUsed',
  '@billedDuration',
  '@requestId',
]

export type InsightsFieldProvider = () => readonly string[]

/** Gọi được nhiều lần: đăng ký đúng một lần cho cả vòng đời app. */
export function registerInsightsLanguage(
  monaco: typeof Monaco,
  fields: InsightsFieldProvider,
): void {
  if (registered) return
  registered = true

  monaco.languages.register({ id: INSIGHTS_LANGUAGE_ID })

  monaco.languages.setMonarchTokensProvider(INSIGHTS_LANGUAGE_ID, {
    defaultToken: '',
    keywords: COMMANDS,
    ignores: /\s+/,
    tokenizer: {
      root: [
        // `|` là RANH GIỚI giữa hai lệnh — thứ duy nhất trong cú pháp Insights
        // thật sự phân tách, nên nó được tô nổi nhất.
        [/\|/, 'delimiter'],
        // Chuỗi nháy kép (giá trị so sánh) và regex /…/ (mẫu `like`).
        [/"/, { token: 'string.quote', next: '@dquote' }],
        [/\/(?![/*])/, { token: 'regexp', next: '@regexp' }],
        // Số: `100`, `1.5`, `1000ms` không tách đơn vị — chỉ cần con số.
        [/\d+(\.\d+)?/, 'number'],
        // Tên trường: `@timestamp`, `duration`, `status`.
        [/[A-Za-z_][\w.]*(?=\s*=|\s*[<>!]=?|\s*\))/, 'variable'],
        [/@[A-Za-z_][\w.]*/, 'variable.predefined'],
        [
          /[A-Za-z_][\w.]*/,
          {
            cases: {
              '@keywords': 'keyword',
              '@default': 'identifier',
            },
          },
        ],
      ],
      dquote: [
        [/[^"\\]+/, 'string'],
        [/\\./, 'string.escape'],
        [/"/, { token: 'string.quote', next: '@pop' }],
      ],
      regexp: [
        [/[^/\\]+/, 'regexp'],
        [/\\./, 'regexp.escape'],
        [/\//, { token: 'regexp', next: '@pop' }],
      ],
    },
  })

  monaco.languages.setLanguageConfiguration(INSIGHTS_LANGUAGE_ID, {
    comments: { lineComment: '#' },
    brackets: [
      ['(', ')'],
      ['[', ']'],
    ],
    autoClosingPairs: [
      { open: '"', close: '"' },
      { open: '(', close: ')' },
      { open: '[', close: ']' },
    ],
  })

  monaco.languages.registerCompletionItemProvider(INSIGHTS_LANGUAGE_ID, {
    triggerCharacters: ['@', ' '],
    provideCompletionItems(model, position) {
      const word = model.getWordUntilPosition(position)
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      }
      // Trường từ KẾT QUẢ TRƯỚC đứng trước: người dùng gõ lại đúng tên cột của
      // mình nhiều hơn là tên cột dựng sẵn của AWS.
      const fromResults = fields().filter((f) => f.startsWith('@') === false && f.length > 0)
      const names = [...new Set([...fromResults, ...BUILTIN_FIELDS])]
      return {
        suggestions: [
          ...COMMANDS.map((c) => ({
            label: c,
            kind: monaco.languages.CompletionItemKind.Keyword,
            insertText: c,
            range,
          })),
          ...FUNCTIONS.map((f) => ({
            label: f,
            kind: monaco.languages.CompletionItemKind.Function,
            insertText: `${f}($0)`,
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            range,
          })),
          ...names.map((f) => ({
            label: f,
            kind: monaco.languages.CompletionItemKind.Field,
            insertText: f,
            range,
          })),
        ],
      }
    },
  })
}
