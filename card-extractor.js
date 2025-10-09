import extract from 'https://esm.sh/png-chunks-extract';

// --- DOM 요소 가져오기 ---
const dropZone = document.getElementById('cardDropZone');
const fileInput = document.getElementById('cardFileInput');
const statusDiv = document.getElementById('cardStatus');
const downloadButtonsDiv = document.getElementById('cardDownloadButtons');
const downloadAssetsByNameBtn = document.getElementById('cardDownloadAssetsByNameBtn');
const downloadAssetsNumberedBtn = document.getElementById('cardDownloadAssetsNumberedBtn'); 
const downloadStructureBtn = document.getElementById('cardDownloadStructureBtn');
const structureContainer = document.getElementById('cardStructureContainer');
const structureView = document.getElementById('cardStructureView');

// --- 상태 저장을 위한 전역 변수 ---
let originalFile = null;
let originalFileBuffer = null;
let cardMetadata = null;
let originalCharxZip = null;
let processedAssetsList = [];

// --- 이벤트 리스너 설정 ---
dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) handleFile(e.dataTransfer.files[0]);
});
fileInput.addEventListener('change', (e) => { if (e.target.files.length > 0) handleFile(e.target.files[0]); });

downloadAssetsByNameBtn.addEventListener('click', downloadAssetsByName);
downloadAssetsNumberedBtn.addEventListener('click', downloadAssetsNumbered);
downloadStructureBtn.addEventListener('click', downloadMetadata);


// --- 헬퍼 함수 ---
function updateStatus(message, type = '') {
    statusDiv.textContent = message;
    statusDiv.className = `status ${type}`;
}

async function isPng(file) {
    if (file.size < 8) return false;
    const pngHeader = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
    const fileSlice = file.slice(0, 8);
    const buffer = await fileSlice.arrayBuffer();
    const uint8array = new Uint8Array(buffer);
    for (let i = 0; i < pngHeader.length; i++) {
        if (uint8array[i] !== pngHeader[i]) return false;
    }
    return true;
}

function countAssetsInMetadata(metadata) {
    if (!metadata || !metadata.data) return 0;
    if (metadata.spec === 'chara_card_v3' && Array.isArray(metadata.data.assets)) {
        return metadata.data.assets.length;
    }
    if (metadata.spec === 'chara_card_v2' && metadata.data.extensions?.risuai) {
        const risuExt = metadata.data.extensions.risuai;
        return (risuExt.emotions || []).length + (risuExt.additionalAssets || []).length + Object.keys(risuExt.vits || {}).length;
    }
    let count = (metadata.data.assets || []).length;
    if (metadata.data.extensions?.risuai) {
        count += (metadata.data.extensions.risuai.emotions || []).length;
        count += (metadata.data.extensions.risuai.additionalAssets || []).length;
    }
    return count;
}


// --- 메인 파일 처리 로직 ---
async function handleFile(file) {
    updateStatus(`'${file.name}' 처리 중...`);
    downloadButtonsDiv.style.display = 'none';
    structureContainer.style.display = 'none';
    structureView.textContent = '';
    
    originalFile = file;
    originalFileBuffer = await file.arrayBuffer();
    cardMetadata = null;
    originalCharxZip = null;
    processedAssetsList = [];

    try {
        if (await isPng(new File([originalFileBuffer], file.name))) {
            const result = await handlePng(originalFileBuffer);
            cardMetadata = result.metadata;
            processedAssetsList = result.assetsList;
        } else {
            try {
                const result = await handleCharx(originalFileBuffer);
                cardMetadata = result.metadata;
                processedAssetsList = result.assetsList;
                originalCharxZip = result.fullZip;
            } catch (zipError) {
                console.error("ZIP으로 처리 실패:", zipError);
                throw new Error("지원하지 않는 파일 형식입니다. PNG 헤더를 포함하거나 유효한 ZIP(.charx) 형식이 아닙니다.");
            }
        }
        
        if (cardMetadata) {
            structureView.textContent = JSON.stringify(cardMetadata, null, 2);
            structureContainer.style.display = 'block';
        }

        const assetCount = processedAssetsList.length;
        const totalAssetCountInMeta = countAssetsInMetadata(cardMetadata);
        
        if (assetCount > 0 || cardMetadata) {
            updateStatus(`추출 완료! 메타데이터의 에셋 ${totalAssetCountInMeta}개 중 ${assetCount}개의 파일을 찾았습니다.`, 'success');
            downloadButtonsDiv.style.display = 'flex';
            const showAssetButtons = assetCount > 0 ? 'block' : 'none';
            downloadAssetsByNameBtn.style.display = showAssetButtons;
            downloadAssetsNumberedBtn.style.display = showAssetButtons;
            downloadStructureBtn.style.display = cardMetadata ? 'block' : 'none';
        } else {
            updateStatus("완료되었지만, 추출할 데이터나 에셋을 파일에서 찾지 못했습니다.", '');
        }

    } catch (error) {
        updateStatus(`오류 발생: ${error.message}`, 'error');
        console.error(error);
    }
}

function getIndexFromUri(uri) {
    if (!uri) return null;
    if (uri.startsWith('__asset:')) {
        return parseInt(uri.split(':').pop(), 10);
    }
    const match = uri.match(/\/(\d+)\.[^/.]+$/);
    return match ? parseInt(match[1], 10) : null;
}
async function handleCharx(buffer) {
    const zip = await JSZip.loadAsync(buffer);
    const cardJsonFile = zip.file('card.json');
    if (!cardJsonFile) throw new Error("'card.json'을 찾을 수 없습니다.");
    const metadata = JSON.parse(await cardJsonFile.async('string'));
    const assetsInfo = metadata?.data?.assets || [];
    const assetsList = [];
    const promises = assetsInfo.map(async (assetInfo) => {
        const { uri, name, ext } = assetInfo;
        if (!uri || !name) return;
        const sourcePath = uri.replace(/embeded?:\/\//, '');
        const sourceFile = zip.file(sourcePath);
        if (sourceFile) {
            const data = await sourceFile.async('uint8array');
            const assetIndex = getIndexFromUri(uri) || assetsList.length;
            if (assetIndex !== null) {
                assetsList.push({ data, name, ext, assetIndex });
            }
        }
    });
    await Promise.all(promises);
    return { metadata, assetsList, fullZip: zip };
}
async function handlePng(buffer) {
    const chunks = extract(new Uint8Array(buffer));
    const textChunks = chunks.filter(chunk => chunk.name === 'tEXt');
    let mainDataStr = null;
    const assetsData = {};
    const assetsList = [];
    textChunks.forEach(chunk => {
        try {
            const decoder = new TextDecoder('utf-8', { fatal: true });
            const decodedString = decoder.decode(chunk.data);
            const nullIndex = decodedString.indexOf('\x00');
            if (nullIndex === -1) return;
            const key = decodedString.substring(0, nullIndex);
            const value = decodedString.substring(nullIndex + 1);
            if (key.startsWith('chara-ext-asset_')) {
                const indexStr = key.replace('chara-ext-asset_:', '').replace('chara-ext-asset_', '');
                const assetIndex = parseInt(indexStr, 10);
                if (!isNaN(assetIndex)) {
                    const byteString = atob(value);
                    const byteArray = new Uint8Array(byteString.length);
                    for (let i = 0; i < byteString.length; i++) byteArray[i] = byteString.charCodeAt(i);
                    assetsData[assetIndex] = byteArray;
                }
            } else if (key === 'chara' || key === 'ccv3') {
                mainDataStr = value;
            }
        } catch (e) { console.warn("UTF-8 디코딩 실패, tEXt 청크를 건너뜁니다:", e); }
    });
    let metadata = null;
    if (mainDataStr) {
        try {
            metadata = mainDataStr.startsWith('rcc||') ? { note: "암호화된 rcc|| 형식 데이터입니다.", raw_data: mainDataStr } : JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(mainDataStr), c => c.charCodeAt(0))));
        } catch (e) {
            metadata = { note: "메인 데이터를 JSON으로 파싱하는 데 실패했습니다.", raw_data: mainDataStr };
        }
    }
    if (Object.keys(assetsData).length > 0 && metadata && metadata.data) {
        const allAssetMeta = (metadata.data?.assets || []).concat(metadata.data?.extensions?.risuai?.additionalAssets || []).concat(metadata.data?.extensions?.risuai?.emotions || []);
        allAssetMeta.forEach(item => {
            let uri, name, ext;
            if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
                ({ uri, name, ext } = item);
            } else if (Array.isArray(item) && item.length >= 2) {
                const pathParts = item[0].split(/[\\/]/);
                name = pathParts.pop().replace(/\.[^/.]+$/, "");
                uri = item[1];
                ext = item.length > 2 ? item[2] : 'png';
            } else return;
            if (uri) {
                const assetIndex = getIndexFromUri(uri);
                if (assetIndex !== null && assetsData[assetIndex]) {
                    assetsList.push({ data: assetsData[assetIndex], name, ext, assetIndex });
                }
            }
        });
    }
    return { metadata, assetsList };
}


// --- 다운로드 함수들 ---
function getFileNameBase() {
    return originalFile.name.replace(/\.[^/.]+$/, "");
}

function downloadZip(zip, filename) {
    zip.generateAsync({ type: 'blob' }).then(content => {
        const url = URL.createObjectURL(content);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    });
}

function downloadAssetsByName() {
    if (processedAssetsList.length === 0) return;
    const zip = new JSZip();
    const usedNames = new Set();

    processedAssetsList.forEach(asset => {
        let baseName = asset.name;
        if (asset.ext && !baseName.toLowerCase().endsWith(`.${asset.ext.toLowerCase()}`)) {
            baseName = `${baseName}.${asset.ext}`;
        }
        
        let finalName = baseName;
        if (usedNames.has(finalName.toLowerCase())) {
            const nameWithoutExt = baseName.substring(0, baseName.lastIndexOf('.'));
            const ext = baseName.substring(baseName.lastIndexOf('.') + 1);
            finalName = `${nameWithoutExt}_${asset.assetIndex}.${ext}`;
        }
        
        zip.file(finalName, asset.data);
        usedNames.add(finalName.toLowerCase());
    });

    downloadZip(zip, `${getFileNameBase()}_assets_by_name.zip`);
}

function downloadAssetsNumbered() {
    if (processedAssetsList.length === 0) return;
    const zip = new JSZip();

    processedAssetsList.forEach(asset => {
        let baseName = asset.name;
        if (asset.ext && !baseName.toLowerCase().endsWith(`.${asset.ext.toLowerCase()}`)) {
            baseName = `${baseName}.${asset.ext}`;
        }
        const finalName = `${asset.assetIndex}_${baseName}`;
        zip.file(finalName, asset.data);
    });

    downloadZip(zip, `${getFileNameBase()}_assets_numbered.zip`);
}


function downloadMetadata() {
    if (cardMetadata) {
        const blob = new Blob([JSON.stringify(cardMetadata, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${getFileNameBase()}_metadata.json`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }
}