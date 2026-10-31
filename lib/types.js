/**
 * @typedef {Object} Job
 * @property {number} id
 * @property {string} title
 * @property {string} company
 * @property {string} location
 * @property {boolean} remote
 * @property {string} experience
 * @property {number|null} experienceMin
 * @property {string[]} skills
 * @property {string} description
 * @property {string} sourceUrl
 * @property {string} source
 */

/**
 * @typedef {Object} Profile
 * @property {string} name
 * @property {string} email
 * @property {string} phone
 * @property {string} location
 * @property {string} designation
 * @property {number|null} totalExperienceYears
 * @property {string[]} skills
 * @property {string[]} targetRoles
 * @property {{degree: string, institution: string, year: string}[]} education
 * @property {{name: string, description: string}[]} projects
 */

/**
 * @typedef {Object} JobFilters
 * @property {boolean} [remote]
 * @property {string[]} [skills]
 * @property {string} [location]
 * @property {string} [titleKeyword]
 * @property {number} [maxExperience]
 * @property {string} [company]
 */

/**
 * @typedef {Object} MatchedJob
 * @property {number} position
 * @property {number} id
 * @property {string} title
 * @property {string} company
 * @property {string} location
 * @property {boolean} remote
 * @property {string} experience
 * @property {string[]} skills
 * @property {string} sourceUrl
 * @property {number} score
 * @property {string} reason
 */

/**
 * @typedef {Object} AppRow
 * @property {number} jobId
 * @property {string} title
 * @property {string} company
 * @property {string} appliedAt
 * @property {string} status
 */

export {};