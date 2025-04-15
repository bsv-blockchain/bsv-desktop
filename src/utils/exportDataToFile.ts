/**
 * Interface for export data parameters
 */
interface ExportDataParams {
  data: any
  filename: string
  type: string
}

/**
 * Exports data to a file with a specified format and filename.
 *
 * @param {ExportDataParams} params - The parameters object.
 * @param {*} params.data - The data to be exported.
 * @param {string} params.filename - The filename for the exported file.
 * @param {string} params.type - The MIME type of the file.
 * @returns {void}
 */
const exportDataToFile = ({ data, filename, type }: ExportDataParams): void => {
  let exportedData: string

  // Depending on the MIME type, process the data accordingly
  if (type === 'application/json') {
    exportedData = JSON.stringify(data, null, 2)
  } else if (type === 'text/plain') {
    exportedData = String(data)
  } else {
    throw new Error('Unsupported file type')
  }

  // Create a new Blob object using the processed data
  const blob = new Blob([exportedData], { type })

  // Create a temporary anchor element to trigger the download
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = filename

  // Append the link, trigger the download, and then clean up
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(link.href)
}

export default exportDataToFile

/**
 * Downloads a binary file with the specified filename and content.
 * 
 * @param {string} filename - The name of the file to be downloaded
 * @param {number[]} fileContent - The binary content as an array of numbers
 * @returns {Promise<boolean>} - A promise that resolves to true if successful, false otherwise
 */
export async function downloadFile(filename: string, fileContent: number[]): Promise<boolean> {
  try {
    // Convert array to Uint8Array for binary data
    const content = new Uint8Array(fileContent);
    
    // Create a blob from the binary data
    const blob = new Blob([content])
    
    // Create a URL for the blob
    const url = URL.createObjectURL(blob)
    
    // Create a download link
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    
    // Trigger download
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    
    // Clean up
    URL.revokeObjectURL(url)
    
    return true
  } catch (e) {
    console.error('Download error:', e);
    return false;
  }
}