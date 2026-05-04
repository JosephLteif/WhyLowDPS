export interface DataFileState {
  key: string;
  label: string;
  section: string;
  relative_path: string;
  required: boolean;
  downloadable: boolean;
  exists: boolean;
  size_bytes: number;
}

export interface DataFileStatesResponse {
  base_path: string | null;
  available: boolean;
  files: DataFileState[];
}

export interface DataFilePreviewResponse {
  key: string;
  label: string;
  relative_path: string;
  content: string;
  truncated: boolean;
}

export type SettingsStatusMessage = {
  type: 'success' | 'error';
  text: string;
};
