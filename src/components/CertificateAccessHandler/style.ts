import { Theme } from "@mui/material/styles";

const styles = (theme: Theme) => ({
  app_icon: {
    minWidth: '8em',
    minHeight: '8em',
    maxHeight: '8em',
    maxWidth: '8em',
    borderRadius: '4px',
    marginTop: theme.spacing(2),
    marginBottom: theme.spacing(1),
  },
  title: {
    marginTop: theme.spacing(3),
  }
})

export default styles
