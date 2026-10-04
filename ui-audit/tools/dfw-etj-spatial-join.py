import json,subprocess,sys
from shapely.geometry import Polygon,MultiPolygon
from shapely.ops import unary_union
def get(u,params):
    a=["curl","-sS","-m","90","-G",u]
    for k,v in params.items(): a+=["--data-urlencode",f"{k}={v}"]
    subprocess.run(a+["-o","/tmp/_j.json"]); return json.load(open('/tmp/_j.json'))
def polys(u,field,where="1=1",off=0.0005):
    d=get(u+"/query",{"where":where,"outFields":field,"returnGeometry":"true","outSR":4326,"maxAllowableOffset":off,"resultRecordCount":2000,"f":"json"})
    out=[]
    for f in d.get('features',[]):
        if not f.get('geometry') or not f['geometry'].get('rings'): continue
        rings=f['geometry']['rings']
        try:
            p=unary_union([Polygon(r).buffer(0) for r in rings])
        except Exception: continue
        out.append((f['attributes'].get(field),p))
    return out
CITY="https://feature.geographic.texas.gov/arcgis/rest/services/City_Boundaries/Texas_City_Boundaries/MapServer/0"
def cities_near(geom,pad=0.01):
    b=geom.bounds
    env=json.dumps({"xmin":b[0]-pad,"ymin":b[1]-pad,"xmax":b[2]+pad,"ymax":b[3]+pad,"spatialReference":{"wkid":4326}})
    d=get(CITY+"/query",{"where":"1=1","geometry":env,"geometryType":"esriGeometryEnvelope","inSR":4326,"spatialRel":"esriSpatialRelIntersects","outFields":"city_name","returnGeometry":"true","outSR":4326,"maxAllowableOffset":0.0005,"f":"json"})
    res=[]
    for f in d.get('features',[]):
        try: res.append((f['attributes']['city_name'],unary_union([Polygon(r).buffer(0) for r in f['geometry']['rings']])))
        except: pass
    return res
def adjacent(geom,cities,tol=0.0004):
    out=[]
    for n,p in cities:
        if geom.buffer(tol).intersects(p): out.append((n, round(geom.buffer(tol).intersection(p).area/geom.area,3)))
    return sorted(out,key=lambda x:-x[1])
if __name__=="__main__":
    which=sys.argv[1]
    if which=="dallas":
        ps=polys("https://services3.arcgis.com/zqe2kwz79KUqUvxC/arcgis/rest/services/Dallas_County_ETJ/FeatureServer/0","City")
        allc=unary_union([p for _,p in ps]); cities=cities_near(allc,0.02)
        bad=0
        for i,(nm,p) in enumerate(ps):
            adj=adjacent(p,cities)
            top=[a for a in adj if a[0].lower()!=str(nm).lower()]
            match=any(a[0].lower()==str(nm).lower() for a in adj)
            if not match: bad+=1
            print(i,nm,"| adjacent:",adj[:4],"| MATCH" if match else "| *** NO ADJACENT CITY OF THAT NAME")
        print("mismatch",bad,"of",len(ps))
