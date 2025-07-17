/**
 * Utility function to open URLs that works across multiple environments:
 * - Tauri desktop apps (using @tauri-apps/plugin-opener)
 * - Web browsers (using window.open)
 * - React Native apps (using Linking API)
 * 
 * Automatically detects the environment and uses the appropriate method.
 */
export async function openUrl(url: string): Promise<void> {
  // Check if we're in a browser environment
  if (typeof window !== 'undefined') {
    try {
      // Try Tauri first (will work in Tauri apps)
      try {
        const { openUrl } = await import('@tauri-apps/plugin-opener');
        await openUrl(url);
        return;
      } catch (tauriError) {
        // Not in Tauri or plugin not available - use browser API instead
        window.open(url, '_blank', 'noopener,noreferrer');
        return;
      }
    } catch (error) {
      console.error('Error opening URL in browser:', error);
    }
  }
  
  // Check for React Native environment
  // This uses feature detection rather than direct imports
  // to avoid requiring react-native as a dependency
  try {
    // Access global object in a type-safe way
    interface ReactNativeGlobal {
      ReactNative?: {
        Linking?: {
          canOpenURL: (url: string) => Promise<boolean>;
          openURL: (url: string) => Promise<void>;
        };
      };
    }
    
    // Check for ReactNative.Linking in global scope
    const globalObj = (typeof global !== 'undefined' ? global : window) as unknown as ReactNativeGlobal;
    
    if (globalObj.ReactNative?.Linking) {
      const Linking = globalObj.ReactNative.Linking;
      const supported = await Linking.canOpenURL(url);
      if (supported) {
        await Linking.openURL(url);
        return;
      } else {
        console.error(`Cannot open URL in React Native: ${url}`);
      }
    }
  } catch (error) {
    // Silently fail if we're not in React Native
  }
  
  // Non-browser, non-React-Native environment (e.g. Node.js)
  console.warn('Unable to open URL - current environment is not supported');
}
