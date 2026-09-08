async page => {
  const errors = [], services = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("request", r => { if (!r.url().startsWith("http://127.0.0.1:5174") && !r.url().startsWith("data:")) services.push(r.url()); });
  await page.goto("http://127.0.0.1:5174/play?dev=game");
  await page.setViewportSize({width:390,height:844});
  await page.locator("canvas").waitFor();
  await page.waitForTimeout(300);
  const rows = ["############","#.......#..#","#..##..##..#","#..S.......#","#..##...#..#","#..#....##.#","#.#.....##.#","#..#....#..#","#.......#..#","############"];
  let pos=[3,3], boulder=[4,6], open=false;
  const eq=(a,b)=>a[0]===b[0]&&a[1]===b[1];
  const assert=(ok,msg)=>{if(!ok)throw Error(msg)};
  const check = async (x,y) => assert((await page.getByTestId("coordinates").textContent()).includes("X "+x+" · Y "+y+" ·"),"coordinates "+x+","+y);
  const step=async key=>{ await page.keyboard.press(key); await page.waitForTimeout(320); };
  const go=async target=>{
    const queue=[[pos,[]]],seen=new Set([pos.join()]);
    let route;
    for(let i=0;i<queue.length;i++){
      const [at,path]=queue[i];
      if(eq(at,target)){route=path;break;}
      for(const [key,dx,dy] of [["ArrowUp",0,-1],["ArrowRight",1,0],["ArrowDown",0,1],["ArrowLeft",-1,0]]){
        const to=[at[0]+dx,at[1]+dy];
        if(rows[to[1]]?.[to[0]]===undefined||rows[to[1]][to[0]]==="#"||eq(to,boulder)||eq(to,[5,3])||eq(to,[6,6])||(!open&&eq(to,[8,3]))||seen.has(to.join()))continue;
        seen.add(to.join());queue.push([to,[...path,[key,to]]]);
      }
    }
    assert(route,"no route "+target);
    for(const [key,to] of route){await step(key);pos=to;await check(...pos);}
  };
  await go([7,3]); await step("ArrowRight"); await check(7,3);
  assert((await page.getByRole("status").textContent()).includes("Temple Key required."),"locked feedback");
  await page.screenshot({path:"output/playwright/puzzle-locked-390.png",fullPage:true});
  for(const target of [[2,3],[1,1],[5,1],[5,8],[1,8]]) await go(target);
  assert((await page.getByTestId("gems").textContent())==="5 / 6","five outer gems");
  await go([5,6]); await step("ArrowLeft");await check(5,6);
  assert((await page.getByRole("status").textContent()).includes("empty tile"),"blocked push");
  await go([4,5]); await step("ArrowDown");pos=[4,6];boulder=[4,7]; await check(...pos);
  await step("ArrowLeft");pos=[3,6];await check(...pos);
  assert((await page.getByRole("status").textContent()).includes("Temple Key found."),"key found");
  await page.screenshot({path:"output/playwright/puzzle-key-390.png",fullPage:true});
  await go([7,3]); await step("ArrowRight");pos=[8,3];open=true;await check(...pos);
  await step("ArrowRight");pos=[9,3];await check(...pos);
  assert(await page.getByRole("heading",{name:"INNER CHAMBER REACHED"}).isVisible(),"shrine");
  assert((await page.getByTestId("hp").textContent())==="100 / 100","safe puzzle route");
  await page.screenshot({path:"output/playwright/puzzle-shrine-390.png",fullPage:true});
  await go([9,1]);
  assert(await page.getByRole("heading",{name:"MISSION COMPLETE",exact:true}).isVisible(),"mission complete");
  assert(await page.getByRole("heading",{name:"MISSION COMPLETE",exact:true}).evaluate(e=>e===document.activeElement),"outcome focus");
  const terminal=await page.getByTestId("coordinates").textContent();
  await step("ArrowDown");
  assert((await page.getByTestId("coordinates").textContent())===terminal,"terminal movement");
  await page.screenshot({path:"output/playwright/puzzle-complete-390.png",fullPage:true});
  const reset=async()=>{await page.getByRole("button",{name:"Reset run",exact:true}).click();pos=[3,3];boulder=[4,6];open=false;await check(3,3);};
  await reset();
  assert((await page.getByTestId("hp").textContent())==="100 / 100","reset HP");
  assert((await page.getByTestId("gems").textContent())==="0 / 6","reset gems");
  assert(await page.getByRole("button",{name:"Move Up",exact:true}).evaluate(e=>e===document.activeElement),"reset focus");
  await go([6,5]);await step("ArrowDown");pos=[6,6];
  assert((await page.getByTestId("hp").textContent())==="80 / 100","poison");
  await reset();
  await go([4,3]);
  for(let i=0;i<4;i++){await step("ArrowRight");if(i<3)await step("ArrowLeft");}
  assert(await page.getByRole("heading",{name:"THE RUINS WON THIS ROUND"}).isVisible(),"death");
  assert((await page.getByTestId("hp").textContent())==="0 / 100","zero HP");
  await page.screenshot({path:"output/playwright/puzzle-failed-390.png",fullPage:true});
  await reset();
  await page.keyboard.press("ArrowLeft");await page.keyboard.press("ArrowLeft");await page.waitForTimeout(250);await check(2,3);
  await reset();
  await go([4,5]);
  await page.keyboard.press("ArrowDown");await page.keyboard.press("r");await page.waitForTimeout(400);await check(3,3);
  assert((await page.getByTestId("gems").textContent())==="0 / 6","pending reset");
  for(let i=0;i<3;i++){await page.getByRole("button",{name:"Exit",exact:true}).click();assert(await page.locator("canvas").count()===0,"canvas unmount");await page.goto("http://127.0.0.1:5174/play?dev=game");await page.locator("canvas").waitFor();assert(await page.locator("canvas").count()===1,"one canvas");}
  assert(errors.length===0,"console errors "+errors.join());
  assert(services.length===0,"service calls "+services.join());
  return {result:"PASS",errors,services};
}
