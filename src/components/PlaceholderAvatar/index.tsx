import React from 'react';
import { Avatar, SxProps } from '@mui/material';

interface PlaceholderAvatarProps {
  name: string;
  variant?: 'circular' | 'rounded' | 'square';
  size?: number;
  sx?: SxProps;
}

/**
 * Generates a deterministic color based on a string
 * @param str Input string
 * @returns Hex color code
 */
function stringToColor(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  
  let color = '#';
  for (let i = 0; i < 3; i++) {
    const value = (hash >> (i * 8)) & 0xFF;
    color += ('00' + value.toString(16)).slice(-2);
  }
  
  return color;
}

/**
 * Extracts initials from a name or domain
 * @param name Input name
 * @returns Up to 2 characters representing the input
 */
function getInitials(name: string): string {
  if (!name) return '?';
  
  // For domain names (e.g., example.com)
  if (name.includes('.')) {
    const parts = name.split('.');
    return parts[0].charAt(0).toUpperCase();
  }
  
  // For regular names or identifiers
  const parts = name.split(/[\s-_]/);
  
  if (parts.length > 1) {
    return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase();
  }
  
  // If it's a single word, return first character
  return name.charAt(0).toUpperCase();
}

/**
 * A component that generates a visually distinctive placeholder avatar
 * when no actual image is available.
 */
const PlaceholderAvatar: React.FC<PlaceholderAvatarProps> = ({
  name,
  variant = 'circular',
  size = 40,
  sx = {}
}) => {
  const bgColor = stringToColor(name);
  const initials = getInitials(name);
  
  return (
    <Avatar
      variant={variant}
      sx={{
        width: size,
        height: size,
        bgcolor: bgColor,
        fontSize: size * 0.4,
        ...sx
      }}
    >
      {initials}
    </Avatar>
  );
};

export default PlaceholderAvatar;
