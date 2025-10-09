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

export async function saveMnemonic(mnemonic: string): Promise<{ success: boolean; path?: string; error?: string }> {
  try {
    const result = await window.electronAPI.saveMnemonic(mnemonic);
    return result;
  } catch (error) {
    console.error('Save mnemonic failed:', error);
    return { success: false, error: String(error) };
  }
}

// Export bundled functions for UserInterface
export const electronFunctions = {
  isFocused,
  onFocusRequested,
  onFocusRelinquished,
  onDownloadFile,
  saveMnemonic
};
