import { decodeRPack } from './rpack_bg.js';

// --- 새 HTML 구조에 맞게 DOM 요소 ID 수정 ---
const dropZone = document.getElementById('moduleDropZone');
const fileInput = document.getElementById('moduleFileInput');
const resultsDiv = document.getElementById('moduleResults');
const statusDiv = document.getElementById('moduleStatus');
const downloadAllBtn = document.getElementById('moduleDownloadAllBtn');
const duplicateWarningDiv = document.getElementById('moduleDuplicateWarning');
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
    // --- [추가됨] 안내 문구 초기화 ---
    duplicateWarningDiv.style.display = 'none';
    duplicateWarningDiv.textContent = '';

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

        const totalAssets = moduleInfo.assets ? moduleInfo.assets.length : 0;

        if (totalAssets === 0) {
            statusDiv.textContent = '완료: 이 파일에는 추출할 에셋이 없습니다.';
            statusDiv.className = 'status success';
            return;
        }

        statusDiv.textContent = `"${moduleInfo.name}" 모듈에서 ${totalAssets}개의 에셋을 발견했습니다. 추출을 시작합니다...`;

        const zip = new JSZip();
        const usedNames = new Set();
        let assetIndex = 0;
        // --- [추가됨] 중복 발생 여부를 추적할 변수 ---
        let wasDuplicateDetected = false;

        while (pos < uint8Array.length && assetIndex < totalAssets) {
            const marker = readByte();
            if (marker === 0) break;
            if (marker !== 1) continue;

            const assetLen = readLength();
            const assetDataPacked = readData(assetLen);
            const assetDataDecoded = await decodeRPack(assetDataPacked);

            const [assetId, _, assetType] = moduleInfo.assets[assetIndex];

            let baseFilename = assetId;
            let extension = null;

            if (assetType && typeof assetType === 'string') {
                const typeParts = assetType.split('/');
                if (typeParts.length > 0) {
                    const potentialExt = typeParts.pop();
                    if (potentialExt && potentialExt.length > 0 && potentialExt.length < 5) {
                        extension = potentialExt;
                    }
                }
            }

            if (!extension) {
                extension = getExtensionFromBytes(assetDataDecoded);
            }

            if (extension && !baseFilename.toLowerCase().endsWith(`.${extension.toLowerCase()}`)) {
                baseFilename = `${baseFilename}.${extension}`;
            }

            let finalFilename = baseFilename;
            if (usedNames.has(finalFilename.toLowerCase())) {
                // --- [추가됨] 중복이 감지되면 플래그를 true로 설정 ---
                wasDuplicateDetected = true;
                const lastDotIndex = baseFilename.lastIndexOf('.');
                if (lastDotIndex !== -1) {
                    const nameWithoutExt = baseFilename.substring(0, lastDotIndex);
                    const ext = baseFilename.substring(lastDotIndex + 1);
                    finalFilename = `${nameWithoutExt}_${assetIndex}.${ext}`;
                } else {
                    finalFilename = `${baseFilename}_${assetIndex}`;
                }
            }
            zip.file(finalFilename, assetDataDecoded);
            usedNames.add(finalFilename.toLowerCase());

            assetIndex++;
            statusDiv.textContent = `추출 중... (${assetIndex} / ${totalAssets})`;
        }

        // --- [추가됨] 모든 루프가 끝난 후, 중복이 있었다면 안내 문구 표시 ---
        if (wasDuplicateDetected) {
            duplicateWarningDiv.innerHTML = '<strong>안내:</strong> 일부 에셋의 이름이 중복되어 파일명 뒤에 고유 번호(예: <code>이름_123.png</code>)를 추가했습니다. <br>이 번호는 파일의 원본 순서(인덱스)이며, 연속적인 숫자가 아닐 수 있습니다.';
            duplicateWarningDiv.style.display = 'block';
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
        statusDiv.textContent = `추출 완료: 총 ${totalAssets}개의 에셋 중 ${assetIndex}개를 성공적으로 추출했습니다.`;

    } catch (error) {
        statusDiv.textContent = `오류가 발생했습니다: ${error.message}`;
        statusDiv.className = 'status error';
        console.error("추출 오류:", error);
    }
}