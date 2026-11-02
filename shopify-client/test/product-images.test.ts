import { describe, expect, it } from "vitest";
import { imageUrls, warningImages } from "../app/services/product-images";
import { loadAllProductImages } from "../app/services/product-images.server";

describe("complete review photographs", () => {
  it("preserves all distinct current and legacy source photographs", () => {
    const pictures=Array.from({length:12},(_,i)=>`https://example.com/${i}.jpg`);
    expect(warningImages({referenceImageUrls:pictures,alertDetails:{fields:{pictures:[{url:pictures[0]}],product_image:pictures[1],product_other_images:'https://example.com/last.jpg'}}})).toEqual([...pictures,'https://example.com/last.jpg']);
    expect(imageUrls('javascript:alert(1)','https://user:password@example.com/image.jpg')).toEqual([]);
  });
  it("reads beyond the first Shopify page without truncating or duplicating images", async () => {
    const calls: unknown[]=[];
    const result=await loadAllProductImages({graphql:async(_query,options)=>{
      calls.push(options?.variables);
      const after=options?.variables?.after;
      return Response.json({data:{product:{id:'gid://shopify/Product/1',updatedAt:'2026-11-02',images:{nodes:after?[{url:'https://example.com/100.jpg'}]:Array.from({length:100},(_,i)=>({url:`https://example.com/${i}.jpg`})),pageInfo:{hasNextPage:!after,endCursor:'next'}}}}});
    }},'gid://shopify/Product/1');
    expect(result).toHaveLength(101);expect(calls).toEqual([{id:'gid://shopify/Product/1',after:null},{id:'gid://shopify/Product/1',after:'next'}]);
  });
  it("does not report partial photos as complete on GraphQL errors or invalid cursors", async () => {
    await expect(loadAllProductImages({graphql:async()=>Response.json({errors:[{message:'Denied'}]})},'gid://shopify/Product/1')).rejects.toThrow();
    await expect(loadAllProductImages({graphql:async()=>Response.json({data:{product:{id:'gid://shopify/Product/1',images:{nodes:[],pageInfo:{hasNextPage:true,endCursor:'repeated'}}}}})},'gid://shopify/Product/1')).rejects.toThrow(/pagination/);
    expect(await loadAllProductImages({graphql:async()=>Response.json({data:{product:null}})},'gid://shopify/Product/1')).toBeNull();
  });
});
