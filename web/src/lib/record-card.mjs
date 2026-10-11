import { el } from './ui.mjs'
import { notice } from './exhibition.mjs'
/** Download only public, observed record data. No wallet identity or private intent. */
export async function downloadRecordCard({title,status,lines,url,observedAt,filename}) {
  const canvas=document.createElement('canvas');canvas.width=1200;canvas.height=800
  const c=canvas.getContext('2d');c.fillStyle='#f4f0e5';c.fillRect(0,0,1200,800);c.fillStyle='#293c31';c.font='24px Georgia';c.fillText('CENTRAL BANK OF BITCOIN',55,65)
  c.strokeStyle='#293c31';c.beginPath();c.moveTo(55,100);c.lineTo(1145,100);c.stroke();c.font='66px Georgia';c.fillText(title,55,198,1090)
  c.save();c.translate(60,240);c.rotate(-.025);c.strokeStyle='#a84726';c.lineWidth=3;c.strokeRect(0,0,620,54);c.fillStyle='#a84726';c.font='20px monospace';c.fillText(status.toUpperCase(),18,35,584);c.restore()
  c.fillStyle='#293c31';lines.slice(0,5).forEach((line,i)=>{c.font=i===0?'42px Georgia':'24px Georgia';c.fillText(line,55,370+i*58,1090)})
  c.font='16px monospace';c.fillText(`OBSERVED ${new Date(observedAt*1000).toLocaleString('en-US', { timeZone: 'America/Chicago', timeZoneName: 'short' })}${Date.now()/1000-observedAt>1800?' / DELAYED RETURN':''}`,55,712,1090);c.font='14px monospace';c.fillText(new URL(url,location.origin).href,55,755,1090)
  const blob=await new Promise(r=>canvas.toBlob(r,'image/png'));if(!blob)throw new Error('The record card could not be created.')
  const href=URL.createObjectURL(blob),a=el('a',{href,download:filename});document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(href),30000);notice('Record card downloaded. Share its permanent link alongside the image.')
}
