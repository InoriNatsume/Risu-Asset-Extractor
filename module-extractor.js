import { decodeRPack } from './rpack_bg.js';

// --- 새 HTML 구조에 맞게 DOM 요소 ID 수정 ---
const dropZone = document.getElementById('moduleDropZone');
const fileInput = document.getElementById('moduleFileInput');
const resultsDiv = document.getElementById('moduleResults');
const statusDiv = document.getElementById('moduleStatus');
const downloadAllBtn = document.getElementById('moduleDownloadAllBtn');
const structureContainer = document.getElementById('moduleStructureContainer');
const structureView = document.getElementById('moduleStructureView');
const downloadStructureBtn = document.getElementById('moduleDownloadStructureBtn');

// --- 이벤트 리스너 설정 ---
dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
});
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    const files = e.dataTransfer.files;
    if (files.length > 0) {
        handleFileSelect(files[0]);
    }
});
fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
        handleFileSelect(e.target.files[0]);
    }
});

function getExtensionFromBytes(uint8Array) {
    if (uint8Array.length < 12) return null;
    if (uint8Array[0] === 137 && uint8Array[1] === 80 && uint8Array[2] === 78 && uint8Array[3] === 71) return 'png';
    if (uint8Array[0] === 255 && uint8Array[1] === 216 && uint8Array[2] === 255) return 'jpg';
    if (uint8Array[0] === 71 && uint8Array[1] === 73 && uint8Array[2] === 70 && uint8Array[3] === 56) return 'gif';
    if (uint8Array[0] === 82 && uint8Array[1] === 73 && uint8Array[2] === 70 && uint8Array[3] === 70 &&
        uint8Array[8] === 87 && uint8Array[9] === 69 && uint8Array[10] === 80 && uint8Array[11] === 80) return 'webp';
    return null;
}

async function handleFileSelect(file) {
    if (!file) return;

    resultsDiv.innerHTML = '';
    statusDiv.textContent = `'${file.name}' 파일 처리 중...`;
    statusDiv.className = 'status';
    downloadAllBtn.style.display = 'none';
    structureContainer.style.display = 'none';
    structureView.textContent = '';
    downloadStructureBtn.onclick = null;

    try {
        const arrayBuffer = await file.arrayBuffer();
        const view = new DataView(arrayBuffer);
        const uint8Array = new Uint8Array(arrayBuffer);
        let pos = 0;

        const readByte = () => { const byte = view.getUint8(pos); pos += 1; return byte; };
        const readLength = () => { const len = view.getUint32(pos, true); pos += 4; return len; };
        const readData = (len) => { const data = uint8Array.subarray(pos, pos + len); pos += len; return data; };

        if (readByte() !== 111) throw new Error('잘못된 매직 넘버입니다.');
        if (readByte() !== 0) throw new Error('지원하지 않는 버전입니다.');

        const mainLen = readLength();
        const mainDataPacked = readData(mainLen);
        const mainDataDecoded = await decodeRPack(mainDataPacked);
        const mainJsonText = new TextDecoder().decode(mainDataDecoded);
        const mainJson = JSON.parse(mainJsonText);
        const moduleInfo = mainJson.module;

        const formattedJson = JSON.stringify(mainJson, null, 2);
        structureView.textContent = formattedJson;
        structureContainer.style.display = 'block';

        downloadStructureBtn.onclick = () => {
            const blob = new Blob([formattedJson], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `${file.name.replace(/\.[^/.]+$/, "")}_structure.json`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
        };

        // --- 변경된 부분 시작 ---

        const totalAssets = moduleInfo.assets ? moduleInfo.assets.length : 0; // 1. 전체 에셋 개수 저장

        if (totalAssets === 0) {
            statusDiv.textContent = '완료: 이 파일에는 추출할 에셋이 없습니다.';
            statusDiv.className = 'status success';
            return;
        }

        statusDiv.textContent = `"${moduleInfo.name}" 모듈에서 ${totalAssets}개의 에셋을 발견했습니다. 추출을 시작합니다...`;

        // --- 변경된 부분 끝 ---

        const zip = new JSZip();
        let assetIndex = 0;

        while (pos < uint8Array.length && assetIndex < totalAssets) { // 조건문에 totalAssets 사용
            const marker = readByte();
            if (marker === 0) break;
            if (marker !== 1) continue;

            const assetLen = readLength();
            const assetDataPacked = readData(assetLen);
            const assetDataDecoded = await decodeRPack(assetDataPacked);
            const [assetId, _, assetType] = moduleInfo.assets[assetIndex];

            let filename = assetId;
            const knownExtensions = /\.(png|jpg|jpeg|gif|webp)$/i;

            if (!knownExtensions.test(assetId)) {
                let extension = null;
                if (assetType && typeof assetType === 'string' && assetType.length > 0 && assetType.length < 5) {
                    extension = assetType.split('/').pop();
                }
                if (!extension) {
                    extension = getExtensionFromBytes(assetDataDecoded);
                }
                if (extension) {
                    filename = `${filename}.${extension}`;
                }
            }

            zip.file(filename, assetDataDecoded);
            assetIndex++;

            // --- 추가된 부분 시작 ---
            statusDiv.textContent = `추출 중... (${assetIndex} / ${totalAssets})`; // 2. 루프 내에서 상태 업데이트
            // --- 추가된 부분 끝 ---
        }

        if (assetIndex > 0) {
            downloadAllBtn.style.display = 'block';
            downloadAllBtn.onclick = () => {
                statusDiv.textContent = 'ZIP 파일 생성 중... 잠시만 기다려주세요.';
                zip.generateAsync({ type: 'blob' }).then(function(content) {
                    const url = URL.createObjectURL(content);
                    const link = document.createElement('a');
                    link.href = url;
                    link.download = `${moduleInfo.name}_assets.zip`;
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                    URL.revokeObjectURL(url);
                    statusDiv.textContent = 'ZIP 파일 다운로드가 시작되었습니다!';
                });
            };
        }

        statusDiv.className = 'status success';
        // --- 변경된 부분 시작 ---
        statusDiv.textContent = `추출 완료: 총 ${totalAssets}개의 에셋 중 ${assetIndex}개를 성공적으로 추출했습니다.`; // 3. 최종 완료 메시지 수정
        // --- 변경된 부분 끝 ---

    } catch (error) {
        statusDiv.textContent = `오류가 발생했습니다: ${error.message}`;
        statusDiv.className = 'status error';
        console.error("추출 오류:", error);
    }
}