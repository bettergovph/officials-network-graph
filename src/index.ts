import './styles.css';
import Sigma, { Camera } from "sigma";
import { NodeBorderProgram } from "@sigma/node-border";
import Graph from "graphology";
import { random } from 'graphology-layout';
import NoverlapLayout from 'graphology-layout-noverlap/worker';
import forceAtlas2 from "graphology-layout-forceatlas2";
import FA2Layout from "graphology-layout-forceatlas2/worker";

type NodeData = Record<string, any>;
type EdgeData = Record<string, any>;

let graph = new Graph<NodeData, EdgeData>();
let sigmaInstance: Sigma<NodeData, EdgeData> | null = null;
let camera: Camera | null = null;
let sensibleSettings: any = null;
let layout: InstanceType<typeof FA2Layout> | null = null;
let noverlap: InstanceType<typeof NoverlapLayout> | null = null;

let simulationRunning = true;
let noverlapRunning = false;

const mapRadius = 1000;

let dynasty: Record<string, any>[] = [];
let poverty: Record<string, any>[] = [];
let electionYears: string[] = ['2019', '2022', '2025'];
let winnersByYear: string[] = ['winners_2019.csv.gz', 'winners_2022.csv.gz', 'winners_2025.csv.gz'];
let winners: Record<string, any>[][] = []; // Holders of winners data for each election year

const regions: string[] = [
    'NATIONAL CAPITAL REGION',
    'REGION I',
    'REGION II',
    'REGION III',
    'REGION IV-A',
    'REGION IV-B',
    'REGION V',
    'REGION VI',
    'REGION VII',
    'REGION VIII',
    'REGION IX',
    'REGION X',
    'REGION XI',
    'REGION XII',
    'REGION XIII',
    'CORDILLERA ADMINISTRATIVE REGION',
    'Autonomous Region in Muslim Mindanao',
];

let selectedRegion: string = 'NATIONAL CAPITAL REGION';
let provinces: Record<string, any> = {};
let graphData: Record<string, any> = {};

let politicianCount = 0;
let politicianIndex = 0;
let totalPoliticianCount = 0;
let totalNodes = 0;
let lastnameCount = 0;
let firstnameCount = 0;
let provinceCount = 0;
let parsedNodes = 0;
let parsedLastnames = 0;

const searchInput = document.getElementById('searchBox') as HTMLInputElement | null;
const container = document.getElementById("container") as HTMLElement;
let searchFragment: string = '';

// --- UI HELPERS ---

function showPopup() {
    $('#infoPopup').css('display', 'block');
    $('#clickShield').css('display', 'block');
}

function closeAllPopups() {
    $('#infoPopup').css('display', 'none');
    $('#lastNameSearchHolder').css('display', 'none');
    $('#clickShield').css('display', 'none');
}

function setContainerSize() {
    $("#container").css({
        height: $(window).height() + "px",
        width: $(window).width() + "px"
    });
}

function field(label: string, value: any) {
    return `<span class="headerData">${label}:</span> ${value}<br />`;
}

// --- CSV PARSING ---

function parseCSVLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const char = line[i]!;
        const nextChar = line[i + 1];

        if (char === '"' && inQuotes && nextChar === '"') {
            current += '"';
            i++;
        } else if (char === '"') {
            inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
            result.push(current.trim());
            current = '';
        } else {
            current += char;
        }
    }

    result.push(current.trim());
    return result;
}

function parseCSVToJSON(csvText: string): Record<string, string>[] {
    const lines = csvText.trim().split(/\r?\n/);
    const headers = parseCSVLine(lines[0] ?? '');

    return lines.slice(1)
        .filter(line => line.trim() !== '')
        .map(line => {
            const values = parseCSVLine(line);
            return headers.reduce<Record<string, string>>((obj, header, index) => {
                obj[header] = values[index] ?? '';
                return obj;
            }, {});
        });
}

// --- DATA LOADING ---

// Load winners CSV files for each election year
async function loadWinnerCSV(index: number): Promise<Record<string, string>[] | undefined> {
    try {
        const url = winnersByYear[index];
        if (url === undefined) throw new Error(`No winners CSV configured for index ${index}`);
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
        let csvText: string;
        if (url.endsWith('.gz') && response.headers.get('content-encoding') !== 'gzip') {
            // Raw gzip bytes — the server didn't set Content-Encoding, so the
            // browser did not auto-decompress; we must do it ourselves.
            if (!response.body) throw new Error(`No response body for gzipped file: ${url}`);
            const ds = new DecompressionStream('gzip');
            csvText = await new Response(response.body.pipeThrough(ds)).text();
        } else {
            // Either not gzipped, or the server sent Content-Encoding: gzip
            // and the browser already decompressed the body transparently.
            csvText = await response.text();
        }
        return parseCSVToJSON(csvText);
    } catch (error) {
        console.error('Error loading CSV:', error);
    }
}

async function loadDynastyCSV(url: string): Promise<Record<string, string>[] | undefined> {
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
        let csvText: string;
        if (url.endsWith('.gz') && response.headers.get('content-encoding') !== 'gzip') {
            // Raw gzip bytes — the server didn't set Content-Encoding, so the
            // browser did not auto-decompress; we must do it ourselves.
            if (!response.body) throw new Error(`No response body for gzipped file: ${url}`);
            const ds = new DecompressionStream('gzip');
            csvText = await new Response(response.body.pipeThrough(ds)).text();
        } else {
            // Either not gzipped, or the server sent Content-Encoding: gzip
            // and the browser already decompressed the body transparently.
            csvText = await response.text();
        }
        return parseCSVToJSON(csvText);
    } catch (error) {
        console.error('Error loading CSV:', error);
    }
}

/*
import.meta.env.DEV is a Vite built-in boolean that is true during npm run dev and false during npm run build.

So this line picks the filename based on environment:

Dev (npm run dev) → loads the plain asog_political_dynasties.csv
Production (npm run build) → loads asog_political_dynasties.csv.gz
Vite replaces import.meta.env.DEV at build time with a literal false, so the dead branch (the .csv path) gets tree-shaken out of the production bundle entirely.

The loadDynastyCSV function then checks if the URL ends in .gz and uses DecompressionStream only in that case — so both paths work through the same function.
*/

const csvFile = import.meta.env.DEV
    ? 'asog_political_dynasties.csv'
    : 'asog_political_dynasties.csv.gz';

async function loadPoverty() {
    try {
        const response = await fetch('poverty.json');
        if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
        poverty = await response.json();
        const data = await loadDynastyCSV(csvFile);
        dynasty = data ?? [];

        politicianIndex = dynasty.length;

        // Load winners CSV files for each election year 2019 onwards
        for (let i = 0; i < winnersByYear.length; i++) {
            const winnerData = await loadWinnerCSV(i);
            winners[i] = winnerData ?? [];

            // Map 2019+ winner data to dynasty array
            for (let j = 0; j < winners[i]!.length; j++) {
                dynasty[politicianIndex] = {
                    'Last_Name': winners[i][j]['last_name'],
                    'First_Name': winners[i][j]['first_name'],
                    'Region': winners[i][j]['region'],
                    'Province': winners[i][j]['province'],
                    'Municipality_City': winners[i][j]['city'],
                    'Position': winners[i][j]['position'],
                    'Year': electionYears[i],
                };
                politicianIndex ++;
            }
        }

        $('#spinnerHolder').css('display', 'none');
        popupInfoHelp();
        main();
    } catch (error) {
        console.error('Error loading JSON:', error);
    }
}

// --- GRAPH DATA PROCESSING ---

function ensureProvince(provinceName: string, municipality: string, index: number) {
    if (provinces[provinceName] === undefined) {
        provinces[provinceName] = { index, id: provinceCount, nodes: [], municipalities: [] };
        provinceCount++;
    }
    provinces[provinceName].nodes.push(totalNodes);
    if (!provinces[provinceName].municipalities.includes(municipality)) {
        provinces[provinceName].municipalities.push(municipality);
    }
}

function initFirstnameEntry(lastName: string, firstName: string, index: number, region: string, provinceName: string) {
    graphData[lastName][firstName] = { ids: [{ index, id: totalNodes, region, province: provinceName }] };
}

function processGraphData() {
    provinces = {};
    graphData = {};
    lastnameCount = 0;
    firstnameCount = 0;
    provinceCount = 0;
    totalNodes = 0;
    parsedNodes = 0;
    parsedLastnames = 0;
    let politicianIndex = politicianCount;

    let i = 0;
    for (i = 0; i < politicianCount; i++) {
        const entry = dynasty[i]!;
        if (entry['Region'] !== selectedRegion) continue;

        const lastName = entry['Last_Name'] as string;
        const firstName = entry['First_Name'] as string;
        const province = entry['Province'] as string;
        const municipality = entry['Municipality_City'] as string;

        if (graphData[lastName] === undefined) {
            graphData[lastName] = { index: i, id: totalNodes, count: lastnameCount };
            totalNodes++;
            lastnameCount++;

            initFirstnameEntry(lastName, firstName, i, entry['Region'], province);
            ensureProvince(province, municipality, i);
            firstnameCount++;
            totalNodes++;
        } else if (graphData[lastName][firstName] === undefined) {
            initFirstnameEntry(lastName, firstName, i, entry['Region'], province);
            ensureProvince(province, municipality, i);
            firstnameCount++;
            totalNodes++;
        } else {
            graphData[lastName][firstName].ids.push({ index: i, id: totalNodes, region: entry['Region'], province });
            firstnameCount++;
            totalNodes++;
        }
    }

    console.log(`Graph Data Processed — lastnames: ${lastnameCount}, firstnames: ${firstnameCount}, provinces: ${provinceCount}`);
}

// --- GRAPH RENDERING ---

function populateGraph() {
    Object.keys(provinces).forEach(key => {
        graph.addNode('province' + provinces[key].id, {
            index: provinces[key].index, nodeType: 'province',
            label: key, x: 0, y: 0, size: 10, color: "#00ff00"
        });
    });

    Object.keys(graphData).forEach(key => {
        const lastnameId = graphData[key].id;
        const angle = Math.random() * 2 * Math.PI;
        const radius = mapRadius * Math.random();
        const nodeX = radius * Math.cos(angle);
        const nodeY = radius * Math.sin(angle);
        const nodeSize = Object.keys(graphData[key]).length;

        graph.addNode(lastnameId, {
            index: graphData[key].index, type: "border", nodeType: 'lastname',
            firstnames: [], label: key, labelColor: '#ffff00',
            x: nodeX, y: nodeY, size: nodeSize, color: '#ff0000', borderColor: '#990000'
        });
        parsedLastnames++;

        Object.keys(graphData[key]).forEach(subKey => {
            if (subKey === 'index' || subKey === 'id' || subKey === 'count') return;

            const firstnameId = graphData[key][subKey].ids[0].id;
            const fnAngle = Math.random() * 2 * Math.PI;
            const fnRadius = Object.keys(graphData[key]).length / 3 * 20000;
            graph.addNode(firstnameId, {
                index: graphData[key][subKey].ids[0].index, type: 'border',
                nodeType: 'firstname', label: subKey,
                x: nodeX + fnRadius * Math.cos(fnAngle),
                y: nodeY + fnRadius * Math.sin(fnAngle),
                size: 3, color: "#0066ff", borderColor: '#000099'
            });

            graph.addEdge(lastnameId, firstnameId, { size: 0.001, color: "#663300" });

            const firstnamesTemp = graph.getNodeAttribute(lastnameId, 'firstnames');
            firstnamesTemp.push(firstnameId);
            graph.setNodeAttribute(lastnameId, 'firstnames', firstnamesTemp);
            parsedNodes++;
        });
    });

    Object.keys(provinces).forEach(key => {
        const province = provinces[key];
        province.nodes.forEach((nodeId: any) => {
            graph.addEdge('province' + province.id, nodeId, { size: 0.0001, color: "#339966" });
        });
    });

    console.log('Parsed Nodes: ' + parsedNodes);
    random.assign(graph);
}

const defaultDrawNodeHover = (context: CanvasRenderingContext2D, data: Record<string, any>, settings: Record<string, any>) => {
    const size = settings['labelSize'];
    const font = settings['labelFont'];
    const weight = settings['labelWeight'];

    context.font = `${weight} ${size}px ${font}`;
    const textWidth = context.measureText(data['label']).width;
    const boxWidth = textWidth + 12;
    const boxHeight = size + 8;

    context.shadowOffsetX = 0;
    context.shadowOffsetY = 2;
    context.shadowBlur = 8;
    context.shadowColor = "rgba(0, 0, 0, 0.3)";

    context.fillStyle = "#333333";
    context.beginPath();
    context.roundRect(data['x'] + data['size'] + 3, data['y'] - boxHeight / 2, boxWidth, boxHeight, 4);
    context.fill();

    context.shadowOffsetX = 0;
    context.shadowOffsetY = 0;
    context.shadowBlur = 0;

    context.fillStyle = "#ffffff";
    context.fillText(data['label'], data['x'] + data['size'] + 9, data['y'] + size / 3);
};

// --- SIGMA / LAYOUT ---

function instantiateGraph() {
    sigmaInstance = new Sigma(graph, container, {
        labelColor: { color: "#ffffff" },
        defaultDrawNodeHover,
        nodeProgramClasses: { border: NodeBorderProgram }
    });
    camera = sigmaInstance.getCamera();
}

function setLayout() {
    sensibleSettings = forceAtlas2.inferSettings(graph);
    layout = new FA2Layout(graph, { settings: sensibleSettings });
    noverlap = new NoverlapLayout(graph, { settings: { margin: 10, ratio: 2 } });
    layout.start();
}

function processDynasty() {
    processGraphData();
    populateGraph();
    instantiateGraph();
    setLayout();
    addListeners();
}

function resetGraph() {
    layout?.stop();
    layout?.kill();
    layout = null;
    noverlap?.stop();
    noverlap?.kill();
    noverlap = null;
    sigmaInstance?.kill();
    sigmaInstance = null;
    graph.clear();
    console.log('Graph reset complete');
}

function resetAndReload() {
    resetGraph();
    processGraphData();
    populateGraph();
    instantiateGraph();
    setLayout();
    sigmaInstance!.on("clickNode", getNodeData);

    simulationRunning = true;
    $('#simulationToggle').text('STOP Force Atlas 2');
    $('#noverlapToggle').text('START No Overlap');
    noverlap!.stop();
    layout!.start();
    $("#lastNameHolder").scrollTop(0);
    console.log('Graph reloaded successfully');
}

// --- CAMERA ---

function panToNode(nodeId: string) {
    const nodeData = graph.getNodeAttributes(nodeId);
    const cameraPosition = sigmaInstance!.viewportToFramedGraph(
        sigmaInstance!.graphToViewport({ x: nodeData['x'], y: nodeData['y'] })
    );
    camera!.animate(cameraPosition, { easing: "quadraticInOut", duration: 500 });
}

// --- EVENT HANDLERS ---

function onToggleSimulation() {
    if (simulationRunning) {
        simulationRunning = false;
        $('#simulationToggle').text('START Force Atlas 2');
        layout!.stop();
    } else {
        simulationRunning = true;
        $('#simulationToggle').text('STOP Force Atlas 2');
        $('#noverlapToggle').text('START No Overlap');
        noverlap!.stop();
        layout!.start();
    }
}

function onNoverlap() {
    simulationRunning = false;
    $('#simulationToggle').text('START Force Atlas 2');
    layout!.stop();

    if (noverlapRunning) {
        noverlapRunning = false;
        noverlap!.stop();
        $('#noverlapToggle').text('START No Overlap');
    } else {
        noverlapRunning = true;
        noverlap!.start();
        $('#noverlapToggle').text('STOP No Overlap');
    }
}

function selectRegion() {
    const dropdown = document.getElementById("dropdownRegion") as HTMLSelectElement;
    selectedRegion = dropdown.value;
    searchFragment = '';
    resetAndReload();
}

function randomizeRegion() {
    const selectElement = document.getElementById("dropdownRegion") as HTMLSelectElement;
    selectedRegion = regions[Math.floor(Math.random() * regions.length)] ?? selectedRegion;
    selectElement.value = selectedRegion;
    resetAndReload();
}

// --- NODE CLICK POPUP ---

function getNodeData(event: { node: string }) {
    const nodeData = graph.getNodeAttributes(event.node);
    const d = dynasty[Number(nodeData['index'])]!;
    let popupContents = '';

    switch (nodeData['nodeType']) {
        case 'firstname':
            popupContents += field('Name', d['First_Name'] + ' ' + d['Last_Name']);
            if (d['fat'] == 1) popupContents += ' <span class="fat">*</span>';
            popupContents += '<br />';
            popupContents += field('Party', d['Party']);
            popupContents += field('Position', d['Position'] + ', ' + d['Year']);
            popupContents += field('Municipality/City', d['Municipality_City']);
            popupContents += field('Province', d['Province']);
            popupContents += field('Region', d['Region']);
            break;

        case 'lastname':
            popupContents += `<span class="headerSurname">${d['Last_Name']} surname holders:</span><br /><br />`;
            for (const firstnameId of nodeData['firstnames']) {
                const fnAttrs = graph.getNodeAttributes(firstnameId);
                const fn = dynasty[Number(fnAttrs['index'])]!;
                popupContents += ` -${fnAttrs['label']} ${d['Last_Name']},`;
                if (fn['fat'] == 1) popupContents += '<span class="fat">*</span>';
                popupContents += ` ${fn['Position']}, ${fn['Year']}: ${fn['Municipality_City']}, ${fn['Province']}<br />`;
            }
            break;

        case 'province': {
            let povertyValue = 0;
            for (const povertyRegion of poverty) {
                if (povertyRegion['region'] === d['Region']) {
                    for (const prov of povertyRegion['provinces']) {
                        if (prov['province'] === d['Province']) { povertyValue = prov['poverty']; break; }
                    }
                    if (povertyValue > 0) break;
                }
            }
            popupContents += field('Region', d['Region']);
            popupContents += field('Province', d['Province']);
            popupContents += field('Poverty Incidence', povertyValue + '%') + '<br />';
            popupContents += field('Cities/Municipalities', '');
            for (const muni of provinces[d['Province']].municipalities) {
                if (muni !== '') popupContents += muni + '<br />';
            }
            break;
        }

        default:
    }

    $('#infoPopupContent').html(popupContents);
    showPopup();
    $("#infoPopupContent").scrollTop(0);
}

// --- SEARCH ---

let lastNames: string[] = [];

function onSearchClick() {
    lastNames = Object.keys(graphData);
    $('#lastNameHolder').html(
        lastNames.map(n => `<div id="_${n}" class="clickableName">${n}</div>`).join('')
    );

    // Filter last names
    (document.getElementById('searchBox') as HTMLInputElement).value = searchFragment;
    const filtered = lastNames.filter(n => n.toLowerCase().includes(searchFragment));
    $('#lastNameHolder').html(
        filtered.map(n => `<div id="_${n}" class="clickableName">${n}</div>`).join('')
    );

    $('#lastNameSearchHolder').css('display', 'block');
    $('#clickShield').css('display', 'block');
    $("#infoPopupContent").scrollTop(0);
    (document.getElementById('searchBox') as HTMLInputElement).focus();
}

function onSearchNameClick(id: string) {
    closeAllPopups();
    panToNode(graphData[id.substring(1)].id);
}

function lastNameSearchClick(e: JQuery.ClickEvent) {
    const target = e.target as HTMLElement;
    if (target.classList.contains('clickableName')) onSearchNameClick(target.id);
}

function onLastNameSearch(e: Event) {
    searchFragment = (e.target as HTMLInputElement).value.toLowerCase().trim();
    const filtered = lastNames.filter(n => n.toLowerCase().includes(searchFragment));
    $('#lastNameHolder').html(
        filtered.map(n => `<div id="_${n}" class="clickableName">${n}</div>`).join('')
    );
}

// --- INFO POPUP ---

function popupInfoHelp() {
    $('#infoPopupContent').html(`
    <p>Use the dropdown to select a region, pan and zoom to explore, and click nodes for detailed information. Zoom in to view node names.</p><br />
    <p><span class="headerData">About this project:</span> (scroll down)</p><br />
    <p>This project is a network graph visualization of Philippine elected officials from 2004-2025. It aims to illustrate the prevalence of potential political dynasties in the country by mapping relationships between politicians sharing the same last name.</p><br />
    <p>Red nodes (circles) represent surnames, blue nodes represent individual politicians, and green nodes represent provinces. At a glance, potential political dynasties may be identified by the size of surname nodes, which corresponds to the number of politicians sharing that surname within the selected region.</p><br />
    <p>Edges (lines) connect surnames to their respective politicians and provinces to the politicians operating within them.</p><br />
    <p>Nodes and edges start out randomized, and coalesce into position using the Force Atlas 2 layout by default. Start or Stop Layout animations by pressing the "START/STOP" layout buttons.</p><br />
    <p>Data is sourced from the the Ateneo Policy Center and the Inclusive Democracy Participate project, the Open Halalan Philippine National and Local Election Dataset, as well as the Philippine Statistics Authority.</p><br />
    <p><span class="headerData">Limitations:</span></p>
    <ul id="listLimitations" type="1">
        <li>Data may not capture all political relationships or nuances.</li>
        <li>Consanguinity is not tracked beyond family name, especially in cases where political families intermarry.</li>
        <li>Individuals in the same region may share the same family name, but may not be related.</li>
        <li>Data only tracks positions in local elections, and does not include national offices, party-list representatives, and Barangay officials.</li>
    </ul>
    <br />
    <p>Click anywhere to dismiss this window.</p>
    `);
    showPopup();
}

// --- LISTENERS ---

function addListeners() {
    $('#simulationToggle').on('click', onToggleSimulation);
    $('#noverlapToggle').on('click', onNoverlap);
    $('#btnReset').on('click', randomizeRegion);
    $('#dropdownRegion').on('change', selectRegion);
    sigmaInstance!.on('clickNode', getNodeData);
    $('#infoPopup').on('click', closeAllPopups);
    $('#clickShield').on('click', closeAllPopups);
    $('#search').on('click', onSearchClick);
    $('#lastNameHolder').on('click', lastNameSearchClick);
    $('#btnInfo').on('click', popupInfoHelp);
    searchInput?.addEventListener('input', onLastNameSearch);
}

// --- MAIN ---

function main() {
    politicianCount = dynasty.length;
    totalPoliticianCount += politicianCount;
    for (let i = 0; i < winners.length; i++) {
        totalPoliticianCount += winners[i].length;
    }
    processDynasty();
}

$(function () {
    setContainerSize();
    $(window).on('resize', setContainerSize);
    $('#spinnerHolder').css('top', ($('#infoPopup').position()?.top ?? 0) + $('#infoPopup').height()! + 20 + 'px');
    loadPoverty();
});
