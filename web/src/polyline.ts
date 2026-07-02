/** Decodes a Google encoded polyline (precision 5) into [lng, lat] pairs, GeoJSON-ordered. */
export function decodePolyline(encoded: string): [number, number][] {
  const points: [number, number][] = [];
  let lat = 0;
  let lon = 0;
  let i = 0;
  const readValue = (): number => {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(i) - 63;
      i += 1;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (i < encoded.length) {
    lat += readValue();
    lon += readValue();
    points.push([lon / 1e5, lat / 1e5]);
  }
  return points;
}
