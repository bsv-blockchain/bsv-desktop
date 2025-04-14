export default (theme: any) => ({
  table_picture: {
    maxWidth: '2.5em'
    // borderRadius: '5em' /* was 3em */
  },
  expiryHoverText: {
    ...theme.templates.expiryHoverText
  },
  // Show expires on hover
  chipContainer: {
    ...theme.templates.chipContainer
  }
})
