import { test } from 'node:test'
import assert from 'node:assert/strict'
import { directionalIndex, closestColumn } from './tvNavigation.ts'
const box=(left:number,top:number,width=120,height=190)=>({left,top,right:left+width,bottom:top+height,width,height})
test('Up chooses aligned previous-row media instead of a distant off-axis control',()=>{
 assert.equal(directionalIndex(box(400,330),[box(90,30,40,30),box(400,80)],'up'),1)
})
test('Left/right never wrap around to the opposite side',()=>{
 assert.equal(directionalIndex(box(100,100),[box(250,100)],'left'),-1)
 assert.equal(directionalIndex(box(100,100),[box(250,100)],'right'),0)
})
test('Vertical shelf transition preserves visible screen column, not offscreen item zero',()=>{
 assert.equal(closestColumn(340,[box(-200,0),box(-60,0),box(90,0),box(240,0),box(390,0)],960),3)
})
test('Different card widths choose nearest column and empty shelves have no target',()=>{
 assert.equal(closestColumn(470,[box(90,0,210),box(320,0,210),box(550,0,210)],960),1)
 assert.equal(closestColumn(470,[],960),-1)
})
