import { forwardRef, useState, useEffect } from 'react'
import { 
  TextField, 
  FormControl, 
  InputLabel, 
  Select, 
  MenuItem,
  FormHelperText,
  Box,
  Stack,
  Typography
} from '@mui/material'
import { parsePhoneNumberFromString, isValidPhoneNumber } from 'libphonenumber-js/min'
import { ISO_3166_ALPHA_2_MAPPINGS } from 'iso-3166-ts'

// Dial codes for countries
const dialCodes: Record<string, string> = {
  'AF': '+93', 'AL': '+355', 'DZ': '+213', 'AS': '+1', 'AD': '+376', 'AO': '+244', 'AI': '+1', 'AG': '+1',
  'AR': '+54', 'AM': '+374', 'AW': '+297', 'AU': '+61', 'AT': '+43', 'AZ': '+994', 'BS': '+1', 'BH': '+973',
  'BD': '+880', 'BB': '+1', 'BY': '+375', 'BE': '+32', 'BZ': '+501', 'BJ': '+229', 'BM': '+1', 'BT': '+975',
  'BO': '+591', 'BA': '+387', 'BW': '+267', 'BR': '+55', 'IO': '+246', 'VG': '+1', 'BN': '+673', 'BG': '+359',
  'BF': '+226', 'BI': '+257', 'KH': '+855', 'CM': '+237', 'CA': '+1', 'CV': '+238', 'KY': '+1', 'CF': '+236',
  'TD': '+235', 'CL': '+56', 'CN': '+86', 'CO': '+57', 'KM': '+269', 'CG': '+242', 'CD': '+243', 'CK': '+682',
  'CR': '+506', 'CI': '+225', 'HR': '+385', 'CU': '+53', 'CY': '+357', 'CZ': '+420', 'DK': '+45', 'DJ': '+253',
  'DM': '+1', 'DO': '+1', 'EC': '+593', 'EG': '+20', 'SV': '+503', 'GQ': '+240', 'ER': '+291', 'EE': '+372',
  'ET': '+251', 'FK': '+500', 'FO': '+298', 'FJ': '+679', 'FI': '+358', 'FR': '+33', 'GF': '+594', 'PF': '+689',
  'GA': '+241', 'GM': '+220', 'GE': '+995', 'DE': '+49', 'GH': '+233', 'GI': '+350', 'GR': '+30', 'GL': '+299',
  'GD': '+1', 'GP': '+590', 'GU': '+1', 'GT': '+502', 'GN': '+224', 'GW': '+245', 'GY': '+592', 'HT': '+509',
  'HN': '+504', 'HK': '+852', 'HU': '+36', 'IS': '+354', 'IN': '+91', 'ID': '+62', 'IR': '+98', 'IQ': '+964',
  'IE': '+353', 'IL': '+972', 'IT': '+39', 'JM': '+1', 'JP': '+81', 'JO': '+962', 'KZ': '+7', 'KE': '+254',
  'KI': '+686', 'KP': '+850', 'KR': '+82', 'KW': '+965', 'KG': '+996', 'LA': '+856', 'LV': '+371', 'LB': '+961',
  'LS': '+266', 'LR': '+231', 'LY': '+218', 'LI': '+423', 'LT': '+370', 'LU': '+352', 'MO': '+853', 'MK': '+389',
  'MG': '+261', 'MW': '+265', 'MY': '+60', 'MV': '+960', 'ML': '+223', 'MT': '+356', 'MH': '+692', 'MQ': '+596',
  'MR': '+222', 'MU': '+230', 'YT': '+262', 'MX': '+52', 'FM': '+691', 'MD': '+373', 'MC': '+377', 'MN': '+976',
  'ME': '+382', 'MS': '+1', 'MA': '+212', 'MZ': '+258', 'MM': '+95', 'NA': '+264', 'NR': '+674', 'NP': '+977',
  'NL': '+31', 'NC': '+687', 'NZ': '+64', 'NI': '+505', 'NE': '+227', 'NG': '+234', 'NU': '+683', 'NF': '+672',
  'MP': '+1', 'NO': '+47', 'OM': '+968', 'PK': '+92', 'PW': '+680', 'PS': '+970', 'PA': '+507', 'PG': '+675',
  'PY': '+595', 'PE': '+51', 'PH': '+63', 'PL': '+48', 'PT': '+351', 'PR': '+1', 'QA': '+974', 'RE': '+262',
  'RO': '+40', 'RU': '+7', 'RW': '+250', 'BL': '+590', 'SH': '+290', 'KN': '+1', 'LC': '+1', 'MF': '+590',
  'PM': '+508', 'VC': '+1', 'WS': '+685', 'SM': '+378', 'ST': '+239', 'SA': '+966', 'SN': '+221', 'RS': '+381',
  'SC': '+248', 'SL': '+232', 'SG': '+65', 'SX': '+1', 'SK': '+421', 'SI': '+386', 'SB': '+677', 'SO': '+252',
  'ZA': '+27', 'GS': '+500', 'SS': '+211', 'ES': '+34', 'LK': '+94', 'SD': '+249', 'SR': '+597', 'SJ': '+47',
  'SZ': '+268', 'SE': '+46', 'CH': '+41', 'SY': '+963', 'TW': '+886', 'TJ': '+992', 'TZ': '+255', 'TH': '+66',
  'TL': '+670', 'TG': '+228', 'TK': '+690', 'TO': '+676', 'TT': '+1', 'TN': '+216', 'TR': '+90', 'TM': '+993',
  'TC': '+1', 'TV': '+688', 'VI': '+1', 'UG': '+256', 'UA': '+380', 'AE': '+971', 'GB': '+44', 'US': '+1',
  'UY': '+598', 'UZ': '+998', 'VU': '+678', 'VA': '+39', 'VE': '+58', 'VN': '+84', 'WF': '+681', 'EH': '+212',
  'YE': '+967', 'ZM': '+260', 'ZW': '+263'
};

// Create a single constant combining ISO country codes with dial codes
const countryCodesWithDialCodes: Array<{code: string; name: string; dialCode: string}> = Object.entries(ISO_3166_ALPHA_2_MAPPINGS)
  .map(([code, name]) => ({
    code,
    name,
    dialCode: dialCodes[code] || ''
  }))
  .filter(country => country.dialCode) // Only include countries with dial codes
  .sort((a, b) => a.name.localeCompare(b.name)); // Sort alphabetically by name

interface PhoneEntryProps {
  value: string;
  onChange: (value: string) => void;
  error?: string;
  required?: boolean;
  disabled?: boolean;
  sx?: any;
}

const PhoneEntry = forwardRef<HTMLDivElement, PhoneEntryProps>((props, ref) => {
  const { value, onChange, error, required = false, disabled = false, sx = {}, ...other } = props;
  const [country, setCountry] = useState<string>('US');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [isValid, setIsValid] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');

  // Initialize from the provided value if any
  useEffect(() => {
    if (value) {
      try {
        const phoneInfo = parsePhoneNumberFromString(value);
        if (phoneInfo) {
          setCountry(phoneInfo.country || 'US');
          setPhoneNumber(phoneInfo.nationalNumber);
        }
      } catch (error) {
        console.error('Error parsing phone number:', error);
      }
    }
  }, [value]);

  // When country or phone number changes, update the parent component
  useEffect(() => {
    if (phoneNumber) {
      try {
        const countryInfo = countryCodesWithDialCodes.find(c => c.code === country);
        const fullNumber = `${countryInfo?.dialCode || '+1'}${phoneNumber}`;
        const isNumberValid = isValidPhoneNumber(fullNumber);
        setIsValid(isNumberValid);
        
        if (isNumberValid) {
          onChange(fullNumber);
          setErrorMessage('');
        } else {
          setErrorMessage('Invalid phone number');
          // Still pass the value to parent even if invalid
          onChange(fullNumber);
        }
      } catch (error) {
        console.error('Error validating phone number:', error);
        const countryInfo = countryCodesWithDialCodes.find(c => c.code === country);
        onChange(`${countryInfo?.dialCode || '+1'}${phoneNumber}`);
        setErrorMessage('Invalid phone number format');
      }
    } else {
      onChange('');
      setIsValid(!required);
      setErrorMessage(required ? 'Phone number is required' : '');
    }
  }, [country, phoneNumber, onChange, required]);

  // Handle phone number input with formatting
  const handlePhoneChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const input = event.target.value.replace(/\D/g, ''); // Strip non-digits
    setPhoneNumber(input);
  };

  return (
    <Box sx={{ width: '100%', ...sx }} {...other}>
      <Stack direction="row" spacing={2}>
        <Box width="40%">
          <FormControl fullWidth variant="outlined" error={!!error} required={required} disabled={disabled}>
            <InputLabel id="country-select-label">Country</InputLabel>
            <Select
              labelId="country-select-label"
              id="country-select"
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              label="Country"
            >
              <MenuItem disabled value="">
                <em>Select a country</em>
              </MenuItem>
              
              {/* All countries alphabetically */}
              {countryCodesWithDialCodes.map(country => (
                <MenuItem key={country.code} value={country.code}>
                  ({country.dialCode}) {country.name}
                </MenuItem>
              ))}
            </Select>
            {error && <FormHelperText>{error}</FormHelperText>}
          </FormControl>
        </Box>
        
        <Box width="70%" position="relative">
          <TextField
            fullWidth
            label="Phone Number"
            variant="outlined"
            onChange={handlePhoneChange}
            error={!isValid || !!error}
            helperText={errorMessage || error}
            required={required}
            disabled={disabled}
            inputRef={ref}
          />
        </Box>
      </Stack>
    </Box>
  );
});

export default PhoneEntry;
