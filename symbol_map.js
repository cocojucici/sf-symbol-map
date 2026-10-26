(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const all = window.FILM_DATA || [];
  const valid = all.filter(r => r.Latitude.trim() && r.Longitude.trim() && Number.isFinite(+r.Latitude) && Number.isFinite(+r.Longitude) && Math.abs(+r.Latitude) <= 90 && Math.abs(+r.Longitude) <= 180);
  const years = all.map(r => +r['Release Year']).filter(y => y > 1800 && y < 2200);
  const minYear = Math.min(...years), maxYear = Math.max(...years);
  const controls = ['search','neighborhood','year-min','year-max'].map($);
  $('data-note').textContent = `${all.length.toLocaleString()} source records · ${all.length - valid.length} without valid coordinates, excluded`;
  for (const name of [...new Set(valid.map(r => r['Analysis Neighborhood'] || 'Unknown neighborhood'))].sort()) {
    const option = document.createElement('option'); option.value = name; option.textContent = name; $('neighborhood').append(option);
  }
  for (const id of ['year-min','year-max']) { $(id).min = minYear; $(id).max = maxYear; $(id).step = 1; }
  function resetValues() { $('search').value = ''; $('neighborhood').value = ''; $('year-min').value = minYear; $('year-max').value = maxYear; }
  resetValues();
  function notice(message) { $('notice').textContent = message; $('notice').hidden = !message; }
  if (!window.L) { notice('Map library could not load. Keep the vendor folder in the same directory as this page.'); return; }
  const map = L.map('map', {zoomControl:false, minZoom:3}).setView([37.765,-122.445],12);
  L.control.zoom({position:'topright'}).addTo(map);
  const tileLatitude = y => Math.atan(Math.sinh(Math.PI * (1 - 2 * y / 4096))) * 180 / Math.PI;
  for (let x=652; x<658; x++) for (let y=1581; y<1587; y++) {
    L.imageOverlay(`tiles/street-${x}-${y}.png`, [[tileLatitude(y+1),x/4096*360-180],[tileLatitude(y),(x+1)/4096*360-180]], {
      attribution:'Tiles &copy; Esri — Sources: Esri, HERE, Garmin, USGS, Intermap, INCREMENT P, NRCan, METI, TomTom, OpenStreetMap contributors'
    }).addTo(map);
  }
  let tileError = false;
  const layer = L.layerGroup().addTo(map);
  let groups = [];
  let radius = count => 4 * Math.sqrt(count);
  const CONFIG = {maxRadius:24};
  function setupSizeScale() {
    if (activeView !== 'area') { radius = count => 4 * Math.sqrt(count); return; }
    radius = (areaScale === 'linear' ? d3.scaleLinear() : d3.scaleSqrt())
      .domain([0, maximum])
      .range([0, CONFIG.maxRadius]);
  }
  function updateLegend() {
    const area = activeView === 'area';
    $('legend-title').textContent = area ? `${areaScale === 'linear' ? 'Linear' : 'Square-root'} radius scale` : 'Larger circles, more records';
    $('legend-description').textContent = area
      ? (areaScale === 'linear' ? 'Radius ∝ count; area ∝ count². Large values are visually exaggerated.' : 'Radius ∝ √count; area ∝ count. Circle areas show the true ratio.')
      : 'Circle area ∝ records at each coordinate. Click a circle to explore productions.';
    $('legend-circles').replaceChildren();
    for (const count of area ? [1,maximum] : [1,10,40]) {
      const el = document.createElement('div'); el.className = 'legend-symbol';
      const r=radius(count);
      el.innerHTML = `<svg width="${r*2+2}" height="${r*2+2}" aria-hidden="true"><circle cx="${r+1}" cy="${r+1}" r="${r}" fill="#d87943" fill-opacity="0.48" stroke="#a85c32" stroke-width="${area ? 0.5 : 1}"/></svg><span>${count} record${count===1?'':'s'}</span>${area ? `<small>r = ${r.toFixed(2)} px</small>` : ''}`;
      $('legend-circles').append(el);
    }
  }
  function popup(group) {
    const titles = new Map();
    for (const row of group.rows) {
      const key = row.Title + '|' + row['Release Year'];
      if (!titles.has(key)) titles.set(key,row);
    }
    return `<h3 class="popup-title">${escape(group.name)}</h3><div class="popup-meta">${group.rows.length} filming records · ${titles.size} productions<br>${escape([...new Set(group.rows.map(r=>r['Analysis Neighborhood'] || 'Unknown neighborhood'))].join(' / '))}<br>${group.lat.toFixed(5)}, ${group.lng.toFixed(5)}</div>` +
      [...titles.values()].sort((a,b)=>+b['Release Year']-+a['Release Year']).map(r=>`<div class="popup-film">${escape(r.Title)} <small>${escape(r['Release Year'] || 'Year unknown')} · Director: ${escape(r.Director || 'Not provided')}<br>${escape(r.Locations || 'Location not provided')}</small></div>`).join('');
  }
  function aggregateLocations(rows) {
    const grouped = new Map();
    for (const row of rows) {
      const key = `${(+row.Latitude).toFixed(5)},${(+row.Longitude).toFixed(5)}`;
      if (!grouped.has(key)) grouped.set(key,{lat:+row.Latitude,lng:+row.Longitude,name:row.Locations || 'Unnamed location',rows:[],count:0});
      const group = grouped.get(key); group.rows.push(row); group.count++;
    }
    return [...grouped.values()];
  }
  const fullLocations = aggregateLocations(valid);
  const maximum = Math.max(...fullLocations.map(d=>d.count));
  const hotspots = fullLocations.filter(d => d.count >= 3);
  let stretchThreshold = 1;
  while (fullLocations.filter(d => d.count >= stretchThreshold).length > 10) stretchThreshold++;
  const stretchLocations = fullLocations.filter(d => d.count >= stretchThreshold).sort((a,b)=>b.count-a.count);
  const singletons = fullLocations.filter(d => d.count === 1).length;
  $('task-total').textContent = fullLocations.length.toLocaleString('en-US');
  $('stretch-answer').textContent = `The smallest threshold is ${stretchThreshold} records: ${stretchLocations.length} places remain. At ${stretchThreshold-1} records, ${fullLocations.filter(d=>d.count>=stretchThreshold-1).length} places remain.`;
  let activeView = 'explore', taskThreshold = 3, areaScale = 'linear';
  const viewTabs = [['explore','explore-tab','explore-panel'],['task','task-tab','task-panel'],['area','area-tab','area-panel']];
  function setTab(view) {
    activeView = view;
    for (const [name,id,panel] of viewTabs) {
      const selected = name === view;
      $(panel).hidden = !selected;
      $(id).setAttribute('aria-selected',String(selected)); $(id).tabIndex=selected?0:-1;
    }
    render(); map.invalidateSize();
  }
  for (const [view,id] of viewTabs) {
    $(id).addEventListener('click',()=>{if(view==='task')taskThreshold=3;setTab(view);});
    $(id).addEventListener('keydown',event=>{
      if (['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) {
        event.preventDefault();
        const current=viewTabs.findIndex(([name])=>name===activeView);
        const index=event.key==='Home'?0:event.key==='End'?2:(current+(event.key==='ArrowRight'?1:2))%3;
        setTab(viewTabs[index][0]); $(viewTabs[index][1]).focus();
      }
    });
  }
  function selectAreaScale(scale) { areaScale=scale; render(); }
  $('linear-scale').addEventListener('click',()=>selectAreaScale('linear'));
  $('sqrt-scale').addEventListener('click',()=>selectAreaScale('sqrt'));
  $('run-area').addEventListener('click',()=>selectAreaScale('linear'));
  $('area-maximum').textContent=maximum;
  $('area-max-heading').textContent=`${maximum} records`;
  $('linear-small').textContent=`${(CONFIG.maxRadius/maximum).toFixed(2)} px`;
  $('sqrt-small').textContent=`${(CONFIG.maxRadius/Math.sqrt(maximum)).toFixed(2)} px`;
  $('area-explanation').textContent=`${Math.round(singletons/fullLocations.length*100)}% of places have only one record. With linear scaling, their radius is just ${(CONFIG.maxRadius/maximum).toFixed(2)} px. The ${maximum}-record circle has ${maximum*maximum} times their area, although it represents only ${maximum} times as many records. With square-root scaling, the area ratio is correctly ${maximum}:1.`;
  $('run-task').addEventListener('click',()=>{taskThreshold=3;render();});
  $('show-stretch').addEventListener('click',()=>{taskThreshold=stretchThreshold;render();});
  for (const group of stretchLocations) {
    const button=document.createElement('button'); button.className='rank-item';
    button.innerHTML=`<span class="rank-body"><span class="rank-name">${escape(group.name)}</span><small class="popup-meta"> · ${group.lat.toFixed(5)}, ${group.lng.toFixed(5)}</small></span><span>${group.count}</span>`;
    button.addEventListener('click',()=>{taskThreshold=stretchThreshold;render();const visible=groups.find(g=>g.lat===group.lat&&g.lng===group.lng);if(visible){map.setView([visible.lat,visible.lng],15);visible.marker.openPopup();}});
    $('stretch-list').append(button);
  }
  function render() {
    const lower = Number($('year-min').value), upper = Number($('year-max').value);
    const invalid = !$('year-min').value || !$('year-max').value || !Number.isInteger(lower) || !Number.isInteger(upper) || lower > upper || lower < minYear || upper > maxYear;
    $('year-min').setAttribute('aria-invalid', String(invalid)); $('year-max').setAttribute('aria-invalid', String(invalid));
    if (activeView === 'explore' && invalid) { notice(`Enter years between ${minYear} and ${maxYear}, with the start year no later than the end year.`); return; }
    if (!tileError) notice('');
    $('year-label').textContent = `${lower} — ${upper}`;
    const query = $('search').value.trim().toLowerCase(), hood = $('neighborhood').value;
    const rows = activeView !== 'explore' ? valid : valid.filter(r => {
      const year = +r['Release Year'];
      return (year ? year >= lower && year <= upper : lower === minYear && upper === maxYear) &&
        (!hood || (r['Analysis Neighborhood'] || 'Unknown neighborhood') === hood) &&
        (!query || [r.Title,r.Locations,r.Director].some(v=>v.toLowerCase().includes(query)));
    });
    const locations = aggregateLocations(rows)
      .filter(d => activeView !== 'task' || d.count >= taskThreshold)
      .sort((a, b) => b.count - a.count);
    groups = locations;
    $('task-answer').textContent = taskThreshold === 3
      ? `${hotspots.length} places remain (≥ 3 records), representing ${hotspots.reduce((sum,d)=>sum+d.count,0).toLocaleString('en-US')} filming records. ${Math.round(singletons/fullLocations.length*100)}% of all places have only one record.`
      : `${groups.length} places remain at ≥ ${taskThreshold} records.`;
    document.querySelector('.map-title').lastChild.textContent = activeView === 'task' ? ` HOTSPOTS / ≥ ${taskThreshold} RECORDS` : activeView === 'area' ? ` AREA TRAP / ${areaScale.toUpperCase()}` : ' FILM LOCATIONS';
    $('scale-code').textContent = areaScale === 'linear' ? 'd3.scaleLinear()' : 'd3.scaleSqrt()';
    $('linear-scale').setAttribute('aria-pressed',String(areaScale==='linear'));
    $('sqrt-scale').setAttribute('aria-pressed',String(areaScale==='sqrt'));
    $('area-result').textContent = `${fullLocations.length.toLocaleString('en-US')} places shown · ${areaScale==='linear'?'Linear':'Square-root'} radius · 0–${maximum} records → 0–24 px. ${areaScale==='linear' ? `Area ratio (${maximum} vs 1): ${maximum*maximum}:1.` : `Area ratio (${maximum} vs 1): ${maximum}:1.`}`;
    setupSizeScale(); updateLegend();
    layer.clearLayers();
    for (const group of groups) {
      group.marker = L.circleMarker([group.lat,group.lng],{radius:radius(group.rows.length),color:'#a85c32',weight:activeView==='area'?0.5:1,fillColor:'#d87943',fillOpacity:0.48}).addTo(layer);
      group.marker.bindPopup(()=>popup(group),{maxWidth:300,minWidth:235});
      group.marker.bindTooltip(`${escape(group.name)} · ${group.rows.length} records`,{direction:'top'});
      group.marker.on('mouseover',()=>group.marker.setStyle({fillOpacity:0.8,weight:2}));
      group.marker.on('mouseout',()=>group.marker.setStyle({fillOpacity:0.48,weight:activeView==='area'?0.5:1}));
    }
    $('record-count').textContent=rows.length.toLocaleString();
    $('location-count').textContent=groups.length.toLocaleString();
    $('film-count').textContent=new Set(rows.map(r=>r.Title+'|'+r['Release Year'])).size.toLocaleString();
    $('ranking').replaceChildren();
    groups.slice(0,5).forEach((group,index)=>{
      const button=document.createElement('button'); button.className='rank-item';
      button.innerHTML=`<span class="rank-num">0${index+1}</span><div class="rank-body"><div class="rank-name">${escape(group.name)}</div><div class="rank-track"><span style="width:${group.rows.length/groups[0].rows.length*100}%"></span></div></div><span class="rank-count">${group.rows.length}</span>`;
      button.addEventListener('click',()=>{map.setView([group.lat,group.lng],15);group.marker.openPopup();});
      $('ranking').append(button);
    });
    if (!rows.length) { $('ranking').textContent='No matching filming records'; if (!tileError) notice('No results. Try a different search or adjust the filters.'); }
  }
  controls.forEach(control=>control.addEventListener('input',render));
  $('reset').addEventListener('click',()=>{resetValues();render();map.setView([37.765,-122.445],12);});
  $('fit').addEventListener('click',()=>{if(groups.length)map.fitBounds(L.latLngBounds(groups.map(g=>[g.lat,g.lng])),{padding:[55,55],maxZoom:16});});
  render();
})();
