import {
  FileArchive,
  FileAudio,
  FileBadge,
  FileCode2,
  FileImage,
  FileJson,
  FileSpreadsheet,
  FileText,
  FileType,
  FileVideo,
  type LucideIcon,
} from 'lucide-vue-next'

export interface FileIconInfo {
  icon: LucideIcon
  color: string
  label: string
}

const MAP: Record<string, FileIconInfo> = {
  py: { icon: FileCode2, color: '#fbbf24', label: 'PY' },
  ts: { icon: FileCode2, color: '#3b82f6', label: 'TS' },
  tsx: { icon: FileCode2, color: '#3b82f6', label: 'TSX' },
  js: { icon: FileCode2, color: '#facc15', label: 'JS' },
  jsx: { icon: FileCode2, color: '#facc15', label: 'JSX' },
  vue: { icon: FileCode2, color: '#22c55e', label: 'VUE' },
  go: { icon: FileCode2, color: '#06b6d4', label: 'GO' },
  rs: { icon: FileCode2, color: '#f97316', label: 'RS' },
  java: { icon: FileCode2, color: '#ef4444', label: 'JAVA' },
  rb: { icon: FileCode2, color: '#ef4444', label: 'RB' },
  sh: { icon: FileCode2, color: '#94a3b8', label: 'SH' },

  md: { icon: FileText, color: '#a3a3a3', label: 'MD' },
  txt: { icon: FileText, color: '#a3a3a3', label: 'TXT' },
  log: { icon: FileText, color: '#a3a3a3', label: 'LOG' },

  json: { icon: FileJson, color: '#fbbf24', label: 'JSON' },
  yaml: { icon: FileJson, color: '#fbbf24', label: 'YAML' },
  yml: { icon: FileJson, color: '#fbbf24', label: 'YAML' },
  toml: { icon: FileJson, color: '#fbbf24', label: 'TOML' },

  csv: { icon: FileSpreadsheet, color: '#22c55e', label: 'CSV' },
  xls: { icon: FileSpreadsheet, color: '#22c55e', label: 'XLS' },
  xlsx: { icon: FileSpreadsheet, color: '#22c55e', label: 'XLSX' },

  zip: { icon: FileArchive, color: '#a78bfa', label: 'ZIP' },
  tar: { icon: FileArchive, color: '#a78bfa', label: 'TAR' },
  gz: { icon: FileArchive, color: '#a78bfa', label: 'GZ' },

  pdf: { icon: FileBadge, color: '#ef4444', label: 'PDF' },

  mp3: { icon: FileAudio, color: '#a78bfa', label: 'MP3' },
  wav: { icon: FileAudio, color: '#a78bfa', label: 'WAV' },

  mp4: { icon: FileVideo, color: '#ec4899', label: 'MP4' },
  mov: { icon: FileVideo, color: '#ec4899', label: 'MOV' },

  png: { icon: FileImage, color: '#22c55e', label: 'PNG' },
  jpg: { icon: FileImage, color: '#22c55e', label: 'JPG' },
  jpeg: { icon: FileImage, color: '#22c55e', label: 'JPEG' },
  svg: { icon: FileImage, color: '#22c55e', label: 'SVG' },
  gif: { icon: FileImage, color: '#22c55e', label: 'GIF' },
}

const DEFAULT: FileIconInfo = { icon: FileType, color: '#94a3b8', label: 'FILE' }

export const fileIconFor = (name: string): FileIconInfo => {
  const dot = name.lastIndexOf('.')
  if (dot < 0) return DEFAULT
  const ext = name.slice(dot + 1).toLowerCase()
  return MAP[ext] ?? DEFAULT
}
