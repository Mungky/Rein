/** Coalesce layout/guard/page profile reads for the same session during navigation. */
let cached: {token:string; expires:number; response:Promise<Response>} | null = null;
export function clearProfileRequest() { cached = null; }
export async function requestProfile(baseUrl:string, token:string): Promise<Response> {
  if (!cached || cached.token !== token || cached.expires <= Date.now()) {
    const response=fetch(`${baseUrl}/api/auth/me`,{headers:{Authorization:`Bearer ${token}`}});
    const entry={token,expires:Infinity,response};cached=entry;
    void response.then(res=>{entry.expires=res.ok?Date.now()+1500:0;},()=>{entry.expires=0;});
  }
  return (await cached.response).clone();
}
