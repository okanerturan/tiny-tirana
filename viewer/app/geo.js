// The one source for the camera and ground constants, shared by the viewer (import { GEO }) and the Python pipeline
// (render/project.py reads this file and parses the object below as JSON). Keep the object valid JSON: double quotes,
// no comments or trailing commas inside the braces.
//   camera   anchor (lat, lon, ellipsoidal groundH), heading/tilt of the fixed orthographic camera, metres per image px
//   ground   ellipsoidal metres of the 3D model's street level in central Tirana (Skanderbeg Square)
//   airport  Rinas reference point and its ellipsoidal ground
//   demBias  post/terrain.py's DEM is a surface model: it reads ~8 m high in town (buildings)
export const GEO = {
  "camera": { "lat": 41.3275, "lon": 19.8187, "groundH": 155.0, "heading": 315.0, "tilt": 45.0, "mpp": 0.146484375 },
  "ground": 146,
  "airport": { "lat": 41.4147, "lon": 19.7206, "elev": 74 },
  "demBias": -8.0
};
