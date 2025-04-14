/**
 * Generates a jdenticon color for a given identifier
 * @param id - The unique identifier to generate an icon for (pubkey, protocolID, etc)
 * @returns A color string
 */
import { Hash, Utils } from '@bsv/sdk'

export const deterministicColor = (id: string): string => {
  const hash = Hash.sha256(id)
  const hue1 = parseInt(Utils.toHex(hash.slice(1,2)), 16) / 255 * 360
  const hue2 = parseInt(Utils.toHex(hash.slice(3, 4)), 16) / 255 * 360
  const color1 = `hsl(${hue1}, 100%, 50%)`
  const color2 = `hsl(${hue2}, 100%, 50%)`
  
  return `linear-gradient(90deg, ${color1}, ${color2})`
};

export default deterministicColor;
