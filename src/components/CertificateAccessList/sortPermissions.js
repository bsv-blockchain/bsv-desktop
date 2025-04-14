/**
 * Sorts and groups an array of permissions by domain and counterparty.
 *
 * This function takes an array of permission objects and organizes them into a nested structure
 * based on the domain and counterparty values. It groups permissions by domain and then by
 * counterparty within each domain, ensuring that each counterparty is listed only once per domain.
 *
 * This allows permissions to be revoked on a per-counterparty basis.
 *
 * @param {Array} permissions - An array of permission objects to be sorted and grouped.
 *
 * @returns {Array} An array of objects, each representing a domain with its unique permissions
 */
const sortPermissions = (permissions) => {
  const groupedPermissions = permissions.reduce((acc, curr) => {
    // Check if the domain already exists in the accumulator
    if (!acc[curr.domain]) {
      // If not, initialize it with the current counterparty and permission grant
      acc[curr.domain] = [curr]
    } else {
      // If it exists, add the counterparty and permission grant if it's not already there
      const existingEntry = acc[curr.domain].find(entry => entry.originator === curr.originator)
      if (!existingEntry) {
        acc[curr.domain].push(curr)
      }
    }
    return acc
  }, {})

  // Convert the grouped permissions object to the desired array format
  return Object.entries(groupedPermissions).map(([originator, permissions]) => ({
    originator,
    permissions
  }))
}
export default sortPermissions
