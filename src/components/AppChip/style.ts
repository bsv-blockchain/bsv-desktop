// TODO: Consider moving AppChip styles here.
export default (theme: any) => ({
  table_picture: {
    maxWidth: '5em'
    // borderRadius: '3em'
  },
  expiryHoverText: {
    ...theme.templates.expiryHoverText
  },
  // Show expires on hover
  chipContainer: {
    ...theme.templates.chipContainer
  }
})
