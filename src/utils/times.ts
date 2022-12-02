// UTC
const convertTimestamp = (timestamp: number): Date => {
  let date = new Date(0);
  date.setUTCSeconds(timestamp)
  return date
}

const convertDate = (date: Date): number => {
  return date.getTime() / 1000
}

const getFirstMomentOfDate = (year: number, month: number, day: number): number => {
  let date = new Date(Date.UTC(year, month - 1, day))
  return convertDate(date)
}

const getLastMomentOfDate = (year: number, month: number, day: number): number => {
  let date = new Date(Date.UTC(year, month - 1, day, 23, 59, 59))
  return convertDate(date)
}

const getIsoDate = (date: Date): string => {
  return date.getUTCFullYear() + '-' + pad(date.getUTCMonth() + 1) + '-' + pad(date.getUTCDate())
}

const pad = (n: number): string => {
  return String(n).padStart(2, '0');
}

const convertIsoDate = (isoDate: string): Date => {
  return convertTimestamp(Date.parse(isoDate) / 1000)
}

export {
  convertTimestamp,
  convertDate,
  getFirstMomentOfDate,
  getLastMomentOfDate,
  getIsoDate,
  convertIsoDate
}