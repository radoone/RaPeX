export interface SafetyGateWeeklyReportRef {
  reference: string;
  publicationDate: string;
  year: number;
  month: number;
  day: number;
  week: number;
  url: string;
}

export interface SafetyGateWeeklyNotification {
  caseNumber: string;
  reference: string;
  category: string;
  product: string;
  brand: string;
  name: string;
  type_numberOfModel: string;
  batchNumber: string;
  barcode: string;
  riskType: string;
  danger: string;
  measures: string;
  urlRecall?: string;
  description: string;
  notifyingCountry: string;
  countryOfOrigin: string;
  type: string;
  level: string;
  pictures: string[];
  onlineTrader?: string;
  companyRecallCode?: string;
  productionDates?: string;
  reportDate: string;
  reportYear: number;
  reportWeek: number;
}

function extractTag(xmlChunk: string, tagName: string): string {
  const regex = new RegExp(`<${tagName}(?:\\s+[^>]*)?>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tagName}>`, "i");
  const match = xmlChunk.match(regex);
  return match ? match[1].trim() : "";
}

function extractPictures(xmlChunk: string): string[] {
  const picturesSection = xmlChunk.match(/<pictures[^>]*>([\s\S]*?)<\/pictures>/i);
  if (!picturesSection) {
    return [];
  }
  const pictureMatches = picturesSection[1].matchAll(/<picture[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/picture>/gi);
  return [...pictureMatches]
    .map((m) => m[1].trim())
    .filter((url) => url.length > 0 && url.startsWith("http"));
}

export function parseWeeklyReportsListXml(xml: string): SafetyGateWeeklyReportRef[] {
  const reportMatches = xml.matchAll(/<weeklyReport[^>]*>([\s\S]*?)<\/weeklyReport>/gi);
  const reports: SafetyGateWeeklyReportRef[] = [];

  for (const match of reportMatches) {
    const chunk = match[1];
    const reference = extractTag(chunk, "reference");
    const publicationDate = extractTag(chunk, "publicationDate");
    const year = parseInt(extractTag(chunk, "year"), 10) || 0;
    const month = parseInt(extractTag(chunk, "month"), 10) || 0;
    const day = parseInt(extractTag(chunk, "day"), 10) || 0;
    const week = parseInt(extractTag(chunk, "week"), 10) || 0;
    const url = extractTag(chunk, "URL").replace(/&amp;/g, "&");

    if (reference && url) {
      reports.push({
        reference,
        publicationDate,
        year,
        month,
        day,
        week,
        url,
      });
    }
  }

  return reports;
}

export function parseWeeklyReportDetailXml(
  xml: string,
  fallbackYear = 2026,
  fallbackWeek = 0,
): SafetyGateWeeklyNotification[] {
  const reportDate = extractTag(xml, "report_date");
  const reportYear = parseInt(extractTag(xml, "report_year"), 10) || fallbackYear;
  const reportWeek = parseInt(extractTag(xml, "report_week"), 10) || fallbackWeek;

  const notificationMatches = xml.matchAll(/<notifications[\s\S]*?<\/notifications>/gi);
  const notifications: SafetyGateWeeklyNotification[] = [];

  for (const match of notificationMatches) {
    const chunk = match[1] || match[0];
    const caseNumber = extractTag(chunk, "caseNumber");
    if (!caseNumber) {
      continue;
    }

    const reference = extractTag(chunk, "reference");
    const category = extractTag(chunk, "category");
    const product = extractTag(chunk, "product");
    const brand = extractTag(chunk, "brand");
    const name = extractTag(chunk, "name");
    const type_numberOfModel = extractTag(chunk, "type_numberOfModel");
    const batchNumber = extractTag(chunk, "batchNumber");
    const barcode = extractTag(chunk, "barcode");
    const riskType = extractTag(chunk, "riskType");
    const danger = extractTag(chunk, "danger");
    const measures = extractTag(chunk, "measures");
    const urlRecall = extractTag(chunk, "URLrecall");
    const description = extractTag(chunk, "description");
    const notifyingCountry = extractTag(chunk, "notifyingCountry");
    const countryOfOrigin = extractTag(chunk, "countryOfOrigin");
    const type = extractTag(chunk, "type");
    const level = extractTag(chunk, "level");
    const pictures = extractPictures(chunk);
    const onlineTrader = extractTag(chunk, "onlineTrader");
    const companyRecallCode = extractTag(chunk, "companyRecallCode");
    const productionDates = extractTag(chunk, "productionDates");

    notifications.push({
      caseNumber,
      reference,
      category,
      product,
      brand,
      name,
      type_numberOfModel,
      batchNumber,
      barcode,
      riskType,
      danger,
      measures,
      urlRecall: urlRecall || undefined,
      description,
      notifyingCountry,
      countryOfOrigin,
      type,
      level,
      pictures,
      onlineTrader: onlineTrader || undefined,
      companyRecallCode: companyRecallCode || undefined,
      productionDates: productionDates || undefined,
      reportDate,
      reportYear,
      reportWeek,
    });
  }

  return notifications;
}
