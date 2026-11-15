export function calendarText(item,now = Date.now()) {
  const stamp = time => new Date(time).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
  const escapeICS = text => String(text).replace(/\\/g,'\\\\').replace(/\r\n|\r|\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;');
  const lines = ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Genso Station//YouTube Schedule//JA','CALSCALE:GREGORIAN','BEGIN:VEVENT',`UID:${item.id}@genso-station.example`,`DTSTAMP:${stamp(now)}`,`DTSTART:${stamp(item.start)}`,`DTEND:${stamp(Date.parse(item.start)+2*3600000)}`,`SUMMARY:${escapeICS(item.title)}`,`DESCRIPTION:${escapeICS(item.channelTitle)}`,`URL:https://www.youtube.com/watch?v=${item.id}`,'END:VEVENT','END:VCALENDAR'];
  // RFC 5545: UTF-8の文字を分断せずに75オクテットで折り返す。
  const encoder = new TextEncoder();
  return lines.map(line => {
    let result = '', count = 0;
    for (const char of line) {
      const bytes = encoder.encode(char).length;
      if (count+bytes > 75) { result += '\r\n '; count = 1; }
      result += char; count += bytes;
    }
    return result;
  }).join('\r\n')+'\r\n';
}
