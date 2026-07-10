import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerSrc;

// Uses chrome.storage.local (not sync) — files are too large for sync's 8KB limit

export function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}

export function getResume() {
  return new Promise(resolve => {
    chrome.storage.local.get('resume', r => resolve(r.resume || null));
  });
}

// 5 MB cap — most resumes are <200KB but give generous room
export async function saveResume(file) {
  if (file.size > 5 * 1024 * 1024) {
    throw new Error('File too large — max 5 MB');
  }
  const dataUrl = await fileToDataUrl(file);
  await chrome.storage.local.set({ resume: { dataUrl, name: file.name } });
  return { dataUrl, name: file.name };
}

export async function clearResume() {
  await chrome.storage.local.remove('resume');
}

// Extract plain text from the saved resume using PDF.js for PDFs
export async function extractResumeText() {
  const resume = await getResume();
  if (!resume?.dataUrl) return '';

  const isPdf = resume.name?.toLowerCase().endsWith('.pdf') ||
                resume.dataUrl.startsWith('data:application/pdf');

  if (isPdf) {
    return await extractPdfText(resume.dataUrl); // let errors propagate to the caller
  }

  if (resume.dataUrl.startsWith('data:text/')) {
    const base64 = resume.dataUrl.split(',')[1];
    return atob(base64).replace(/\s+/g, ' ').trim();
  }

  return resume.name || '';
}

async function extractPdfText(dataUrl) {
  const base64 = dataUrl.split(',')[1];
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    pages.push(content.items.map(item => item.str).join(' '));
  }
  return pages.join(' ').replace(/\s+/g, ' ').trim();
}
