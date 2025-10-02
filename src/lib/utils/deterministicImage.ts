/**
 * Generates a jdenticon URL for a given identifier
 * @param id - The unique identifier to generate an icon for (pubkey, protocolID, etc)
 * @returns A data URL containing the jdenticon SVG
 */
import * as jdenticon from 'jdenticon';

export const deterministicImage = (id: string): string => {
  // Generate the SVG as a string
  const svg = jdenticon.toSvg(id, 100);
  
  // Convert the SVG to a data URL
  const dataUrl = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  
  return dataUrl;
};

export default deterministicImage;
