// Electron native handlers that wrap the IPC calls
export async function isFocused(): Promise<boolean> {
  return window.electronAPI.isFocused();
}

export async function onFocusRequested(): Promise<void> {
  return window.electronAPI.requestFocus();
}

export async function onFocusRelinquished(): Promise<void> {
  return window.electronAPI.relinquishFocus();
}

export async function onDownloadFile(fileData: Blob, fileName: string): Promise<boolean> {
  try {
    // Convert Blob to array buffer then to number array
    const arrayBuffer = await fileData.arrayBuffer();
    const content = Array.from(new Uint8Array(arrayBuffer));

    const result = await window.electronAPI.downloadFile(fileName, content);
    return result.success;
  } catch (error) {
    console.error('Download failed:', error);
    return false;
  }
}

// Export bundled functions for UserInterface
export const electronFunctions = {
  isFocused,
  onFocusRequested,
  onFocusRelinquished,
  onDownloadFile
};
