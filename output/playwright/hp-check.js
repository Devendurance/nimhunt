async (page) => {
  const errors = [], services = [], results = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (['fetch','xhr'].includes(request.resourceType()) && !request.url().includes('/@')) services.push(request.url());
  });
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  await page.goto('http://localhost:5173/play?dev=game');
  await page.locator('canvas').waitFor();
  let position = { x: 3, y: 3 };
  const layout = ['############','#..........#','#..##..##..#','#..S.......#','#..##......#','#..##...##.#','#.......##.#','#..##......#','#..........#','############'];
  const vectors = { ArrowUp:[0,-1], ArrowDown:[0,1], ArrowLeft:[-1,0], ArrowRight:[1,0] };
  const status = () => page.getByTestId('coordinates').textContent();
  const step = async key => {
    const [dx,dy] = vectors[key], next = {x:position.x+dx,y:position.y+dy};
    if (layout[next.y]?.[next.x] && layout[next.y][next.x] !== '#') position=next;
    await page.keyboard.press(key);
    await page.waitForFunction(({x,y}) => {
      const text = document.querySelector('[data-testid="coordinates"]')?.textContent;
      return text?.startsWith('X '+x+' · Y '+y+' ·') && text.endsWith('IDLE');
    },position);
  };
  const route = async (target,avoidHazards=true) => {
    const queue = [[position,[]]], seen=new Set([position.x+','+position.y]);
    let found;
    for(let i=0;i<queue.length;i++) {
      const [p,path]=queue[i];
      if(p.x===target.x && p.y===target.y) { found=path; break; }
      for(const [key,[dx,dy]] of Object.entries(vectors)) {
        const q={x:p.x+dx,y:p.y+dy}, id=q.x+','+q.y;
        if(seen.has(id) || !layout[q.y]?.[q.x] || layout[q.y][q.x]==='#' || (avoidHazards && ['5,3','6,6'].includes(id))) continue;
        seen.add(id); queue.push([q,[...path,key]]);
      }
    }
    assert(found,'No route to target');
    for(const key of found) await step(key);
  };
  const reset = async () => {
    await page.getByRole('button',{name:'Reset run',exact:true}).click();
    position={x:3,y:3};
    await page.waitForFunction(() => document.querySelector('[data-testid="gems"]')?.textContent==='0 / 6');
    assert(await page.getByTestId('hp').textContent()==='100 / 100','Reset HP');
  };
  for(const width of [320,390,430,768,1440]) {
    await page.setViewportSize({width,height:844});
    await page.screenshot({path:'output/playwright/hp-game-'+width+'.png',fullPage:true});
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
    assert(!overflow,'Overflow '+width);
    assert(await page.locator('canvas').count()===1,'Duplicate canvas');
    results.push({width,overflow});
  }
  await page.setViewportSize({width:390,height:844});
  await step('ArrowLeft');
  assert(await page.getByTestId('gems').textContent()==='1 / 6','Gem missing');
  await step('ArrowRight'); await step('ArrowLeft');
  assert(await page.getByTestId('gems').textContent()==='1 / 6','Double collection');
  await reset();
  await step('ArrowRight'); await step('ArrowRight');
  assert(await page.getByTestId('hp').textContent()==='75 / 100','Spikes damage');
  for(let i=0;i<3;i++) { await step('ArrowLeft'); await step('ArrowRight'); }
  assert(await page.getByRole('heading',{name:'THE RUINS WON THIS ROUND'}).count()===1,'No death');
  const dead = await status();
  await page.keyboard.press('ArrowDown');
  assert(await status()===dead,'Moved after death');
  assert(await page.evaluate(()=>document.activeElement?.id)==='run-outcome','Death focus');
  await page.screenshot({path:'output/playwright/hp-failure-390.png',fullPage:true});
  await reset();
  assert(await page.getByRole('button',{name:'Move Up'}).evaluate(el=>el===document.activeElement),'Reset focus');
  await route({x:6,y:5});
  await step('ArrowDown');
  assert(await page.getByTestId('hp').textContent()==='80 / 100','Poison damage');
  await reset();
  // Start a move then reset before its 160ms callback.
  await page.keyboard.press('ArrowRight');
  await page.getByRole('button',{name:'Reset run',exact:true}).click();
  await page.waitForTimeout(250);
  assert((await status()).startsWith('X 3 · Y 3'),'Stale reset callback');
  assert((await status()).includes('Steps 0'),'Reset step count');
  position={x:3,y:3};
  // Rapid blocked moves must not unlock another move.
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(180);
  assert((await status()).startsWith('X 3 · Y 3'),'Overlapping bump');
  const beforeScroll=await page.evaluate(()=>scrollY);
  await page.getByRole('button',{name:'Move Left'}).click();
  position={x:2,y:3};
  await page.waitForFunction(()=>document.querySelector('[data-testid="gems"]')?.textContent==='1 / 6');
  assert(await page.evaluate(()=>scrollY)===beforeScroll,'D-pad scroll');
  for(const [x,y] of [[1,1],[5,1],[9,1],[10,4],[7,6]]) await route({x,y});
  assert(await page.getByTestId('gems').textContent()==='6 / 6','Target not reached');
  assert(await page.getByRole('heading',{name:'MISSION COMPLETE',exact:true}).count()===1,'No completion');
  const completed=await status();
  await page.keyboard.press('ArrowLeft');
  assert(await status()===completed,'Moved after complete');
  assert(await page.evaluate(()=>document.activeElement?.id)==='run-outcome','Completion focus');
  await page.screenshot({path:'output/playwright/hp-complete-390.png',fullPage:true});
  await page.setViewportSize({width:320,height:480});
  await page.getByRole('button',{name:'Reset run',exact:true}).scrollIntoViewIfNeeded();
  await page.screenshot({path:'output/playwright/hp-complete-short.png',fullPage:true});
  await page.getByRole('button',{name:'Return to missions',exact:true}).click();
  await page.getByRole('heading',{name:"Today's missions",level:1}).waitFor();
  assert(await page.getByRole('heading',{name:"Today's missions",level:1}).count()===1,'Return tab');
  assert(await page.locator('canvas').count()===0,'Canvas not removed');
  await page.reload();
  await page.getByRole('heading',{name:"Today's hunt",level:1}).waitFor();
  assert(await page.getByRole('heading',{name:"Today's hunt",level:1}).count()===1,'Transient state survived reload');
  for(let i=0;i<3;i++) {
    await page.goto('http://localhost:5173/play?dev=game');
    await page.locator('canvas').waitFor();
    assert(await page.locator('canvas').count()===1,'Remount duplicate');
    await page.getByRole('button',{name:'Exit',exact:true}).click();
    await page.getByRole('heading',{name:"Today's hunt",level:1}).waitFor();
    assert(await page.locator('canvas').count()===0,'Unmount canvas');
  }
  return {results,errors,services,passed:'collection, both hazards, death, completion, terminal input, reset, navigation, lifecycle'};
}
