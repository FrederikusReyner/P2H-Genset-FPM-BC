// Grafik Excel (grafik batang) untuk rekap PMMR. ExcelJS belum bisa membuat grafik, jadi bagian grafik
// ditulis langsung sebagai berkas XML lalu disisipkan ke dalam berkas .xlsx hasil ExcelJS.
import JSZip from 'jszip';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const NS_C = 'http://schemas.openxmlformats.org/drawingml/2006/chart';
const NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

const strCache = (vals) =>
  `<c:strCache><c:ptCount val="${vals.length}"/>${vals.map((v, i) => `<c:pt idx="${i}"><c:v>${esc(v)}</c:v></c:pt>`).join('')}</c:strCache>`;
const numCache = (vals, fmt = 'General') =>
  `<c:numCache><c:formatCode>${esc(fmt)}</c:formatCode><c:ptCount val="${vals.length}"/>${vals
    .map((v, i) => (v === null || v === undefined || Number.isNaN(v) ? '' : `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>`))
    .join('')}</c:numCache>`;

/**
 * Grafik batang berkelompok.
 * cats: { ref, values[] }  series: [{ nameRef, name, ref, values[], color, fmt }]
 */
export function barChartXml({ title, subtitle, cats, series, percent = false }) {
  const ser = series
    .map(
      (s, i) => `<c:ser><c:idx val="${i}"/><c:order val="${i}"/>
<c:tx><c:strRef><c:f>${esc(s.nameRef)}</c:f>${strCache([s.name])}</c:strRef></c:tx>
<c:spPr><a:solidFill><a:srgbClr val="${s.color}"/></a:solidFill></c:spPr><c:invertIfNegative val="0"/>
<c:dLbls><c:numFmt formatCode="${esc(s.fmt || (percent ? '0%' : '#,##0'))}" sourceLinked="0"/><c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr>
<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="800"/></a:pPr><a:endParaRPr lang="en-US"/></a:p></c:txPr>
<c:showLegendKey val="0"/><c:showVal val="1"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="0"/><c:showBubbleSize val="0"/></c:dLbls>
<c:cat><c:strRef><c:f>${esc(cats.ref)}</c:f>${strCache(cats.values)}</c:strRef></c:cat>
<c:val><c:numRef><c:f>${esc(s.ref)}</c:f>${numCache(s.values, percent ? '0%' : 'General')}</c:numRef></c:val></c:ser>`,
    )
    .join('');
  const para = (t, sz) => `<a:p><a:pPr><a:defRPr sz="${sz}" b="1"/></a:pPr><a:r><a:rPr lang="en-US" sz="${sz}" b="1"/><a:t>${esc(t)}</a:t></a:r></a:p>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="${NS_C}" xmlns:a="${NS_A}" xmlns:r="${NS_R}"><c:roundedCorners val="0"/>
<c:chart><c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/>${para(title, 1400)}${subtitle ? para(subtitle, 1100) : ''}</c:rich></c:tx><c:overlay val="0"/></c:title>
<c:autoTitleDeleted val="0"/><c:plotArea><c:layout/>
<c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/>${ser}<c:gapWidth val="120"/><c:axId val="50010001"/><c:axId val="50010002"/></c:barChart>
<c:catAx><c:axId val="50010001"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:numFmt formatCode="General" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="800"/></a:pPr><a:endParaRPr lang="en-US"/></a:p></c:txPr><c:crossAx val="50010002"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>
<c:valAx><c:axId val="50010002"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:majorGridlines><c:spPr><a:ln w="6350"><a:solidFill><a:srgbClr val="D9D9D9"/></a:solidFill></a:ln></c:spPr></c:majorGridlines><c:numFmt formatCode="${percent ? '0%' : '#,##0'}" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="800"/></a:pPr><a:endParaRPr lang="en-US"/></a:p></c:txPr><c:crossAx val="50010001"/><c:crosses val="autoZero"/><c:crossBetween val="between"/></c:valAx>
</c:plotArea><c:legend><c:legendPos val="b"/><c:overlay val="0"/></c:legend><c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart></c:chartSpace>`;
}

function drawingXml(anchors) {
  const items = anchors
    .map(
      (a, i) => `<xdr:twoCellAnchor><xdr:from><xdr:col>${a.c1}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${a.r1}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>${a.c2}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${a.r2}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>
<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${i + 2}" name="Grafik ${i + 1}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="${NS_C}"><c:chart xmlns:c="${NS_C}" xmlns:r="${NS_R}" r:id="rId${i + 1}"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>`,
    )
    .join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="${NS_A}">${items}</xdr:wsDr>`;
}

/**
 * Sisipkan grafik ke berkas .xlsx.
 * plan: [{ sheetName, charts: [{ xml, c1, r1, c2, r2 }] }]  (kolom dan baris dihitung dari 0)
 */
export async function injectCharts(xlsxBuffer, plan) {
  const zip = await JSZip.loadAsync(xlsxBuffer);
  const wbXml = await zip.file('xl/workbook.xml').async('string');
  const relsXml = await zip.file('xl/_rels/workbook.xml.rels').async('string');
  const sheetFile = (name) => {
    const m = new RegExp(`<sheet [^>]*name="${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*r:id="([^"]+)"`).exec(wbXml);
    if (!m) throw new Error(`lembar ${name} tidak ditemukan`);
    const t = new RegExp(`<Relationship [^>]*Id="${m[1]}"[^>]*Target="([^"]+)"|<Relationship [^>]*Target="([^"]+)"[^>]*Id="${m[1]}"`).exec(relsXml);
    const target = (t[1] || t[2]).replace(/^\/?(xl\/)?/, '');
    return `xl/${target}`;
  };

  let content = await zip.file('[Content_Types].xml').async('string');
  const overrides = [];
  let chartNo = 0;
  let drawNo = 100;
  for (const item of plan) {
    if (!item.charts.length) continue;
    const sf = sheetFile(item.sheetName);
    const base = sf.split('/').pop();
    drawNo += 1;
    const dName = `drawing${drawNo}.xml`;
    const dRels = [];
    item.charts.forEach((c, i) => {
      chartNo += 1;
      zip.file(`xl/charts/chart${chartNo}.xml`, c.xml);
      overrides.push(`<Override PartName="/xl/charts/chart${chartNo}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`);
      dRels.push(`<Relationship Id="rId${i + 1}" Type="${NS_R}/chart" Target="../charts/chart${chartNo}.xml"/>`);
    });
    zip.file(`xl/drawings/${dName}`, drawingXml(item.charts));
    zip.file(`xl/drawings/_rels/${dName}.rels`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${dRels.join('')}</Relationships>`);
    overrides.push(`<Override PartName="/xl/drawings/${dName}" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`);

    // hubungkan lembar ke gambar
    const relPath = `xl/worksheets/_rels/${base}.rels`;
    let rel = zip.file(relPath) ? await zip.file(relPath).async('string') : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`;
    const rid = `rIdChart${drawNo}`;
    rel = rel.replace('</Relationships>', `<Relationship Id="${rid}" Type="${NS_R}/drawing" Target="../drawings/${dName}"/></Relationships>`);
    zip.file(relPath, rel);
    let sheet = await zip.file(sf).async('string');
    if (!/xmlns:r=/.test(sheet.slice(0, 600))) sheet = sheet.replace('<worksheet ', `<worksheet xmlns:r="${NS_R}" `);
    sheet = sheet.replace('</worksheet>', `<drawing r:id="${rid}"/></worksheet>`);
    zip.file(sf, sheet);
  }
  content = content.replace('</Types>', `${overrides.join('')}</Types>`);
  zip.file('[Content_Types].xml', content);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
