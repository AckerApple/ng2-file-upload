import { Directive, EventEmitter, ElementRef, Input, Output, HostListener } from '@angular/core';
import { createInvisibleFileInputWrap, isFileInput, detectSwipe } from "./doc-event-help.functions";
import { acceptType, applyExifRotation, dataUrl } from "./fileTools";
/** A master base set of logic intended to support file select/drag/drop operations
 NOTE: Use ngfDrop for full drag/drop. Use ngfSelect for selecting
*/
export class ngf {
    constructor(element) {
        this.element = element;
        this.filters = [];
        this.lastFileCount = 0;
        this.ngfFixOrientation = true;
        this.fileDropDisabled = false;
        this.selectable = false;
        this.directiveInit = new EventEmitter();
        this.lastInvalids = [];
        this.lastInvalidsChange = new EventEmitter();
        this.lastBaseUrlChange = new EventEmitter();
        this.fileChange = new EventEmitter();
        this.files = [];
        this.filesChange = new EventEmitter();
        this.fileSelectStart = new EventEmitter();
        this.initFilters();
    }
    initFilters() {
        // the order is important
        this.filters.push({ name: 'accept', fn: this._acceptFilter });
        this.filters.push({ name: 'fileSize', fn: this._fileSizeFilter });
        //this.filters.push({name: 'fileType', fn: this._fileTypeFilter})
        //this.filters.push({name: 'queueLimit', fn: this._queueLimitFilter})
        //this.filters.push({name: 'mimeType', fn: this._mimeTypeFilter})
    }
    ngOnDestroy() {
        delete this.fileElm; //faster memory release of dom element
        this.destroyPasteListener();
    }
    ngOnInit() {
        const selectable = (this.selectable || this.selectable === '') && !['false', 'null', '0'].includes(this.selectable);
        if (selectable) {
            this.enableSelecting();
        }
        if (this.multiple) {
            this.paramFileElm().setAttribute('multiple', this.multiple);
        }
        this.evalCapturePaste();
        //create reference to this class with one cycle delay to avoid ExpressionChangedAfterItHasBeenCheckedError
        setTimeout(() => {
            this.directiveInit.emit(this);
        }, 0);
    }
    ngOnChanges(changes) {
        var _a;
        if (changes.accept) {
            this.paramFileElm().setAttribute('accept', changes.accept.currentValue || '*');
        }
        if (changes.capturePaste) {
            this.evalCapturePaste();
        }
        // Did we go from having a file to not having a file? Clear file element then
        if (changes.file && changes.file.previousValue && !changes.file.currentValue) {
            this.clearFileElmValue();
        }
        // Did we go from having files to not having files? Clear file element then
        if (changes.files) {
            const filesWentToZero = changes.files.previousValue.length && !((_a = changes.files.currentValue) === null || _a === void 0 ? void 0 : _a.length);
            if (filesWentToZero) {
                this.clearFileElmValue();
            }
        }
    }
    evalCapturePaste() {
        const isActive = this.capturePaste || this.capturePaste === '' || ['false', '0', 'null'].includes(this.capturePaste);
        if (isActive) {
            if (this.pasteCapturer) {
                return; // already listening
            }
            this.pasteCapturer = (e) => {
                const clip = e.clipboardData;
                if (clip && clip.files && clip.files.length) {
                    this.handleFiles(clip.files);
                    e.preventDefault();
                }
            };
            window.addEventListener('paste', this.pasteCapturer);
            return;
        }
        this.destroyPasteListener();
    }
    destroyPasteListener() {
        if (this.pasteCapturer) {
            window.removeEventListener('paste', this.pasteCapturer);
            delete this.pasteCapturer;
        }
    }
    paramFileElm() {
        if (this.fileElm)
            return this.fileElm; // already defined
        // elm already is a file input
        const isFile = isFileInput(this.element.nativeElement);
        if (isFile) {
            return this.fileElm = this.element.nativeElement;
        }
        // the host elm is NOT a file input
        return this.fileElm = createFileElm({
            change: this.changeFn.bind(this)
        });
    }
    enableSelecting() {
        let elm = this.element.nativeElement;
        if (isFileInput(elm)) {
            const bindedHandler = event => this.beforeSelect(event);
            elm.addEventListener('click', bindedHandler);
            elm.addEventListener('touchstart', bindedHandler);
            return;
        }
        const bindedHandler = ev => this.clickHandler(ev);
        elm.addEventListener('click', bindedHandler);
        elm.addEventListener('touchstart', bindedHandler);
        elm.addEventListener('touchend', bindedHandler);
    }
    getValidFiles(files) {
        const rtn = [];
        for (let x = files.length - 1; x >= 0; --x) {
            if (this.isFileValid(files[x])) {
                rtn.push(files[x]);
            }
        }
        return rtn;
    }
    getInvalidFiles(files) {
        const rtn = [];
        for (let x = files.length - 1; x >= 0; --x) {
            let failReason = this.getFileFilterFailName(files[x]);
            if (failReason) {
                rtn.push({
                    file: files[x],
                    type: failReason
                });
            }
        }
        return rtn;
    }
    // Primary handler of files coming in
    handleFiles(files) {
        const valids = this.getValidFiles(files);
        if (files.length != valids.length) {
            this.lastInvalids = this.getInvalidFiles(files);
        }
        else {
            delete this.lastInvalids;
        }
        this.lastInvalidsChange.emit(this.lastInvalids);
        if (valids.length) {
            if (this.ngfFixOrientation) {
                this.applyExifRotations(valids)
                    .then(fixedFiles => this.que(fixedFiles));
            }
            else {
                this.que(valids);
            }
        }
        if (this.isEmptyAfterSelection()) {
            this.element.nativeElement.value = '';
        }
    }
    que(files) {
        this.files = this.files || [];
        Array.prototype.push.apply(this.files, files);
        //below break memory ref and doesnt act like a que
        //this.files = files//causes memory change which triggers bindings like <ngfFormData [files]="files"></ngfFormData>
        this.filesChange.emit(this.files);
        if (files.length) {
            this.fileChange.emit(this.file = files[0]);
            if (this.lastBaseUrlChange.observers.length) {
                dataUrl(files[0])
                    .then(url => this.lastBaseUrlChange.emit(url));
            }
        }
        //will be checked for input value clearing
        this.lastFileCount = this.files.length;
    }
    /** called when input has files */
    changeFn(event) {
        var fileList = event.__files_ || (event.target && event.target.files);
        if (!fileList)
            return;
        this.stopEvent(event);
        this.handleFiles(fileList);
    }
    clickHandler(evt) {
        const elm = this.element.nativeElement;
        if (elm.getAttribute('disabled') || this.fileDropDisabled) {
            return false;
        }
        var r = detectSwipe(evt);
        // prevent the click if it is a swipe
        if (r !== false)
            return r;
        const fileElm = this.paramFileElm();
        fileElm.click();
        //fileElm.dispatchEvent( new Event('click') );
        this.beforeSelect(evt);
        return false;
    }
    beforeSelect(event) {
        this.fileSelectStart.emit(event);
        if (this.files && this.lastFileCount === this.files.length)
            return;
        // if no files in array, be sure browser does not prevent reselect of same file (see github issue 27)
        this.clearFileElmValue();
    }
    clearFileElmValue() {
        this.fileElm.value = null;
    }
    isEmptyAfterSelection() {
        return !!this.element.nativeElement.attributes.multiple;
    }
    stopEvent(event) {
        event.preventDefault();
        event.stopPropagation();
    }
    transferHasFiles(transfer) {
        if (!transfer.types) {
            return false;
        }
        if (transfer.types.indexOf) {
            return transfer.types.indexOf('Files') !== -1;
        }
        else if (transfer.types.contains) {
            return transfer.types.contains('Files');
        }
        else {
            return false;
        }
    }
    eventToFiles(event) {
        const transfer = eventToTransfer(event);
        if (transfer) {
            if (transfer.files && transfer.files.length) {
                return transfer.files;
            }
            if (transfer.items && transfer.items.length) {
                return transfer.items;
            }
        }
        return [];
    }
    applyExifRotations(files) {
        const mapper = (file, index) => {
            return applyExifRotation(file)
                .then(fixedFile => files.splice(index, 1, fixedFile));
        };
        const proms = [];
        for (let x = files.length - 1; x >= 0; --x) {
            proms[x] = mapper(files[x], x);
        }
        return Promise.all(proms).then(() => files);
    }
    onChange(event) {
        let files = this.element.nativeElement.files || this.eventToFiles(event);
        if (!files.length)
            return;
        this.stopEvent(event);
        this.handleFiles(files);
    }
    getFileFilterFailName(file) {
        for (let i = 0; i < this.filters.length; i++) {
            if (!this.filters[i].fn.call(this, file)) {
                return this.filters[i].name;
            }
        }
        return undefined;
    }
    isFileValid(file) {
        const noFilters = !this.accept && (!this.filters || !this.filters.length);
        if (noFilters) {
            return true; //we have no filters so all files are valid
        }
        return this.getFileFilterFailName(file) ? false : true;
    }
    isFilesValid(files) {
        for (let x = files.length - 1; x >= 0; --x) {
            if (!this.isFileValid(files[x])) {
                return false;
            }
        }
        return true;
    }
    _acceptFilter(item) {
        return acceptType(this.accept, item.type, item.name);
    }
    _fileSizeFilter(item) {
        return !(this.maxSize && item.size > this.maxSize);
    }
}
ngf.decorators = [
    { type: Directive, args: [{
                selector: "[ngf]",
                exportAs: "ngf"
            },] }
];
ngf.ctorParameters = () => [
    { type: ElementRef }
];
ngf.propDecorators = {
    multiple: [{ type: Input }],
    accept: [{ type: Input }],
    maxSize: [{ type: Input }],
    ngfFixOrientation: [{ type: Input }],
    fileDropDisabled: [{ type: Input }],
    selectable: [{ type: Input }],
    directiveInit: [{ type: Output, args: ['init',] }],
    lastInvalids: [{ type: Input }],
    lastInvalidsChange: [{ type: Output }],
    lastBaseUrl: [{ type: Input }],
    lastBaseUrlChange: [{ type: Output }],
    file: [{ type: Input }],
    fileChange: [{ type: Output }],
    files: [{ type: Input }],
    filesChange: [{ type: Output }],
    fileSelectStart: [{ type: Output }],
    capturePaste: [{ type: Input }],
    onChange: [{ type: HostListener, args: ['change', ['$event'],] }]
};
/** browsers try hard to conceal data about file drags, this tends to undo that */
export function filesToWriteableObject(files) {
    const jsonFiles = [];
    for (let x = 0; x < files.length; ++x) {
        jsonFiles.push({
            type: files[x].type,
            kind: files[x]["kind"]
        });
    }
    return jsonFiles;
}
/** Only used when host element we are attached to is NOT a fileElement */
function createFileElm({ change }) {
    // use specific technique to hide file element within
    const label = createInvisibleFileInputWrap();
    this.fileElm = label.getElementsByTagName('input')[0];
    this.fileElm.addEventListener('change', change);
    return this.element.nativeElement.appendChild(label); // put on html stage
}
export function eventToTransfer(event) {
    if (event.dataTransfer)
        return event.dataTransfer;
    return event.originalEvent ? event.originalEvent.dataTransfer : null;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibmdmLmRpcmVjdGl2ZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9maWxlLXVwbG9hZC9uZ2YuZGlyZWN0aXZlLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLE9BQU8sRUFBRSxTQUFTLEVBQUUsWUFBWSxFQUFFLFVBQVUsRUFBRSxLQUFLLEVBQUUsTUFBTSxFQUFFLFlBQVksRUFBaUIsTUFBTSxlQUFlLENBQUM7QUFDaEgsT0FBTyxFQUFFLDRCQUE0QixFQUFFLFdBQVcsRUFBRSxXQUFXLEVBQUUsTUFBTSw0QkFBNEIsQ0FBQTtBQUNuRyxPQUFPLEVBQ0wsVUFBVSxFQUNWLGlCQUFpQixFQUFFLE9BQU8sRUFDM0IsTUFBTSxhQUFhLENBQUE7QUFPcEI7O0VBRUU7QUFLRixNQUFNLE9BQU8sR0FBRztJQWdDZCxZQUFtQixPQUFrQjtRQUFsQixZQUFPLEdBQVAsT0FBTyxDQUFXO1FBOUJyQyxZQUFPLEdBQStDLEVBQUUsQ0FBQTtRQUN4RCxrQkFBYSxHQUFXLENBQUMsQ0FBQTtRQUtoQixzQkFBaUIsR0FBWSxJQUFJLENBQUE7UUFFakMscUJBQWdCLEdBQVksS0FBSyxDQUFBO1FBQ2pDLGVBQVUsR0FBcUIsS0FBSyxDQUFBO1FBQzdCLGtCQUFhLEdBQXFCLElBQUksWUFBWSxFQUFFLENBQUE7UUFFM0QsaUJBQVksR0FBcUIsRUFBRSxDQUFBO1FBQ2xDLHVCQUFrQixHQUEyQyxJQUFJLFlBQVksRUFBRSxDQUFBO1FBRy9FLHNCQUFpQixHQUF3QixJQUFJLFlBQVksRUFBRSxDQUFBO1FBRzNELGVBQVUsR0FBdUIsSUFBSSxZQUFZLEVBQUUsQ0FBQTtRQUVwRCxVQUFLLEdBQVUsRUFBRSxDQUFBO1FBQ2hCLGdCQUFXLEdBQXdCLElBQUksWUFBWSxFQUFVLENBQUM7UUFFOUQsb0JBQWUsR0FBdUIsSUFBSSxZQUFZLEVBQUUsQ0FBQTtRQU9oRSxJQUFJLENBQUMsV0FBVyxFQUFFLENBQUE7SUFDcEIsQ0FBQztJQUVELFdB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LENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxhQUFhLENBQUMsWUFBWSxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUE7QUFDdkUsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IERpcmVjdGl2ZSwgRXZlbnRFbWl0dGVyLCBFbGVtZW50UmVmLCBJbnB1dCwgT3V0cHV0LCBIb3N0TGlzdGVuZXIsIFNpbXBsZUNoYW5nZXMgfSBmcm9tICdAYW5ndWxhci9jb3JlJztcbmltcG9ydCB7IGNyZWF0ZUludmlzaWJsZUZpbGVJbnB1dFdyYXAsIGlzRmlsZUlucHV0LCBkZXRlY3RTd2lwZSB9IGZyb20gXCIuL2RvYy1ldmVudC1oZWxwLmZ1bmN0aW9uc1wiXG5pbXBvcnQge1xuICBhY2NlcHRUeXBlLCBJbnZhbGlkRmlsZUl0ZW0sXG4gIGFwcGx5RXhpZlJvdGF0aW9uLCBkYXRhVXJsXG59IGZyb20gXCIuL2ZpbGVUb29sc1wiXG5cbmV4cG9ydCBpbnRlcmZhY2UgZHJhZ01ldGF7XG4gIHR5cGU6c3RyaW5nXG4gIGtpbmQ6c3RyaW5nXG59XG5cbi8qKiBBIG1hc3RlciBiYXNlIHNldCBvZiBsb2dpYyBpbnRlbmRlZCB0byBzdXBwb3J0IGZpbGUgc2VsZWN0L2RyYWcvZHJvcCBvcGVyYXRpb25zXG4gTk9URTogVXNlIG5nZkRyb3AgZm9yIGZ1bGwgZHJhZy9kcm9wLiBVc2UgbmdmU2VsZWN0IGZvciBzZWxlY3RpbmdcbiovXG5ARGlyZWN0aXZlKHtcbiAgc2VsZWN0b3I6IFwiW25nZl1cIixcbiAgZXhwb3J0QXM6XCJuZ2ZcIlxufSlcbmV4cG9ydCBjbGFzcyBuZ2Yge1xuICBmaWxlRWxtOiBhbnlcbiAgZmlsdGVyczoge25hbWU6IHN0cmluZywgZm46IChmaWxlOkZpbGUpPT5ib29sZWFufVtdID0gW11cbiAgbGFzdEZpbGVDb3VudDogbnVtYmVyID0gMFxuXG4gIEBJbnB1dCgpIG11bHRpcGxlICE6c3RyaW5nXG4gIEBJbnB1dCgpIGFjY2VwdCAgICE6c3RyaW5nXG4gIEBJbnB1dCgpIG1heFNpemUgICE6bnVtYmVyXG4gIEBJbnB1dCgpIG5nZkZpeE9yaWVudGF0aW9uOiBib29sZWFuID0gdHJ1ZVxuXG4gIEBJbnB1dCgpIGZpbGVEcm9wRGlzYWJsZWQ6IGJvb2xlYW4gPSBmYWxzZVxuICBASW5wdXQoKSBzZWxlY3RhYmxlOiBib29sZWFuIHwgc3RyaW5nID0gZmFsc2VcbiAgQE91dHB1dCgnaW5pdCcpIGRpcmVjdGl2ZUluaXQ6RXZlbnRFbWl0dGVyPG5nZj4gPSBuZXcgRXZlbnRFbWl0dGVyKClcblxuICBASW5wdXQoKSBsYXN0SW52YWxpZHM6SW52YWxpZEZpbGVJdGVtW10gPSBbXVxuICBAT3V0cHV0KCkgbGFzdEludmFsaWRzQ2hhbmdlOkV2ZW50RW1pdHRlcjx7ZmlsZTpGaWxlLHR5cGU6c3RyaW5nfVtdPiA9IG5ldyBFdmVudEVtaXR0ZXIoKVxuXG4gIEBJbnB1dCgpIGxhc3RCYXNlVXJsITogc3RyaW5nLy9iYXNlNjQgbGFzdCBmaWxlIHVwbG9hZGVkIHVybFxuICBAT3V0cHV0KCkgbGFzdEJhc2VVcmxDaGFuZ2U6RXZlbnRFbWl0dGVyPHN0cmluZz4gPSBuZXcgRXZlbnRFbWl0dGVyKClcblxuICBASW5wdXQoKSBmaWxlITogRmlsZS8vbGFzdCBmaWxlIHVwbG9hZGVkXG4gIEBPdXRwdXQoKSBmaWxlQ2hhbmdlOiBFdmVudEVtaXR0ZXI8RmlsZT4gPSBuZXcgRXZlbnRFbWl0dGVyKClcblxuICBASW5wdXQoKSBmaWxlczpGaWxlW10gPSBbXVxuICBAT3V0cHV0KCkgZmlsZXNDaGFuZ2U6RXZlbnRFbWl0dGVyPEZpbGVbXT4gPSBuZXcgRXZlbnRFbWl0dGVyPEZpbGVbXT4oKTtcblxuICBAT3V0cHV0KCkgZmlsZVNlbGVjdFN0YXJ0OkV2ZW50RW1pdHRlcjxFdmVudD4gPSBuZXcgRXZlbnRFbWl0dGVyKClcblxuICBASW5wdXQoKSBjYXB0dXJlUGFzdGU6IGJvb2xlYW4gLy8gd2luZG93IHBhc3RlIGZpbGUgd2F0Y2hpbmcgKGVtcHR5IHN0cmluZyB0dXJucyBvbilcblxuICBwYXN0ZUNhcHR1cmVyITogKGU6IEV2ZW50KSA9PiB2b2lkIC8vIGdvZXMgd2l0aCBjYXB0dXJlUGFzdGVcblxuICBjb25zdHJ1Y3RvcihwdWJsaWMgZWxlbWVudDpFbGVtZW50UmVmKXtcbiAgICB0aGlzLmluaXRGaWx0ZXJzKClcbiAgfVxuXG4gIGluaXRGaWx0ZXJzKCl7XG4gICAgLy8gdGhlIG9yZGVyIGlzIGltcG9ydGFudFxuICAgIHRoaXMuZmlsdGVycy5wdXNoKHtuYW1lOiAnYWNjZXB0JywgZm46IHRoaXMuX2FjY2VwdEZpbHRlcn0pXG4gICAgdGhpcy5maWx0ZXJzLnB1c2goe25hbWU6ICdmaWxlU2l6ZScsIGZuOiB0aGlzLl9maWxlU2l6ZUZpbHRlcn0pXG5cbiAgICAvL3RoaXMuZmlsdGVycy5wdXNoKHtuYW1lOiAnZmlsZVR5cGUnLCBmbjogdGhpcy5fZmlsZVR5cGVGaWx0ZXJ9KVxuICAgIC8vdGhpcy5maWx0ZXJzLnB1c2goe25hbWU6ICdxdWV1ZUxpbWl0JywgZm46IHRoaXMuX3F1ZXVlTGltaXRGaWx0ZXJ9KVxuICAgIC8vdGhpcy5maWx0ZXJzLnB1c2goe25hbWU6ICdtaW1lVHlwZScsIGZuOiB0aGlzLl9taW1lVHlwZUZpbHRlcn0pXG4gIH1cblxuICBuZ09uRGVzdHJveSgpe1xuICAgIGRlbGV0ZSB0aGlzLmZpbGVFbG0vL2Zhc3RlciBtZW1vcnkgcmVsZWFzZSBvZiBkb20gZWxlbWVudFxuICAgIHRoaXMuZGVzdHJveVBhc3RlTGlzdGVuZXIoKTtcbiAgfVxuXG4gIG5nT25Jbml0KCl7XG4gICAgY29uc3Qgc2VsZWN0YWJsZSA9ICh0aGlzLnNlbGVjdGFibGUgfHwgdGhpcy5zZWxlY3RhYmxlPT09JycpICYmICFbJ2ZhbHNlJywgJ251bGwnLCAnMCddLmluY2x1ZGVzKHRoaXMuc2VsZWN0YWJsZSBhcyBzdHJpbmcpO1xuICAgIGlmKCBzZWxlY3RhYmxlICl7XG4gICAgICB0aGlzLmVuYWJsZVNlbGVjdGluZygpXG4gICAgfVxuXG4gICAgaWYoIHRoaXMubXVsdGlwbGUgKXtcbiAgICAgIHRoaXMucGFyYW1GaWxlRWxtKCkuc2V0QXR0cmlidXRlKCdtdWx0aXBsZScsIHRoaXMubXVsdGlwbGUpXG4gICAgfVxuXG4gICAgdGhpcy5ldmFsQ2FwdHVyZVBhc3RlKCk7XG5cbiAgICAvL2NyZWF0ZSByZWZlcmVuY2UgdG8gdGhpcyBjbGFzcyB3aXRoIG9uZSBjeWNsZSBkZWxheSB0byBhdm9pZCBFeHByZXNzaW9uQ2hhbmdlZEFmdGVySXRIYXNCZWVuQ2hlY2tlZEVycm9yXG4gICAgc2V0VGltZW91dCgoKT0+e1xuICAgICAgdGhpcy5kaXJlY3RpdmVJbml0LmVtaXQodGhpcylcbiAgICB9LCAwKVxuICB9XG5cbiAgbmdPbkNoYW5nZXMoIGNoYW5nZXM6IFNpbXBsZUNoYW5nZXMgKXtcbiAgICBpZiggY2hhbmdlcy5hY2NlcHQgKXtcbiAgICAgIHRoaXMucGFyYW1GaWxlRWxtKCkuc2V0QXR0cmlidXRlKCdhY2NlcHQnLCBjaGFuZ2VzLmFjY2VwdC5jdXJyZW50VmFsdWUgfHwgJyonKVxuICAgIH1cblxuICAgIGlmIChjaGFuZ2VzLmNhcHR1cmVQYXN0ZSkge1xuICAgICAgdGhpcy5ldmFsQ2FwdHVyZVBhc3RlKCk7XG4gICAgfVxuXG4gICAgLy8gRGlkIHdlIGdvIGZyb20gaGF2aW5nIGEgZmlsZSB0byBub3QgaGF2aW5nIGEgZmlsZT8gQ2xlYXIgZmlsZSBlbGVtZW50IHRoZW5cbiAgICBpZiAoY2hhbmdlcy5maWxlICYmIGNoYW5nZXMuZmlsZS5wcmV2aW91c1ZhbHVlICYmICFjaGFuZ2VzLmZpbGUuY3VycmVudFZhbHVlKSB7XG4gICAgICB0aGlzLmNsZWFyRmlsZUVsbVZhbHVlKClcbiAgICB9XG5cbiAgICAvLyBEaWQgd2UgZ28gZnJvbSBoYXZpbmcgZmlsZXMgdG8gbm90IGhhdmluZyBmaWxlcz8gQ2xlYXIgZmlsZSBlbGVtZW50IHRoZW5cbiAgICBpZiAoY2hhbmdlcy5maWxlcykge1xuICAgICAgY29uc3QgZmlsZXNXZW50VG9aZXJvID0gY2hhbmdlcy5maWxlcy5wcmV2aW91c1ZhbHVlLmxlbmd0aCAmJiAhY2hhbmdlcy5maWxlcy5jdXJyZW50VmFsdWU/Lmxlbmd0aFxuXG4gICAgICBpZiAoZmlsZXNXZW50VG9aZXJvKSB7XG4gICAgICAgIHRoaXMuY2xlYXJGaWxlRWxtVmFsdWUoKVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIGV2YWxDYXB0dXJlUGFzdGUoKSB7XG4gICAgY29uc3QgaXNBY3RpdmUgPSB0aGlzLmNhcHR1cmVQYXN0ZSB8fCAodGhpcy5jYXB0dXJlUGFzdGUgYXMgYW55KT09PScnIHx8IFsnZmFsc2UnLCAnMCcsICdudWxsJ10uaW5jbHVkZXModGhpcy5jYXB0dXJlUGFzdGUgYXMgYW55KTtcblxuICAgIGlmIChpc0FjdGl2ZSkge1xuICAgICAgaWYgKHRoaXMucGFzdGVDYXB0dXJlcikge1xuICAgICAgICByZXR1cm47IC8vIGFscmVhZHkgbGlzdGVuaW5nXG4gICAgICB9XG5cbiAgICAgIHRoaXMucGFzdGVDYXB0dXJlciA9IChlOiBFdmVudCkgPT4ge1xuICAgICAgICBjb25zdCBjbGlwID0gKGUgYXMgYW55KS5jbGlwYm9hcmREYXRhO1xuICAgICAgICBpZiAoY2xpcCAmJiBjbGlwLmZpbGVzICYmIGNsaXAuZmlsZXMubGVuZ3RoKSB7XG4gICAgICAgICAgdGhpcy5oYW5kbGVGaWxlcyhjbGlwLmZpbGVzKTtcbiAgICAgICAgICBlLnByZXZlbnREZWZhdWx0KCk7XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgd2luZG93LmFkZEV2ZW50TGlzdGVuZXIoJ3Bhc3RlJywgdGhpcy5wYXN0ZUNhcHR1cmVyKTtcblxuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHRoaXMuZGVzdHJveVBhc3RlTGlzdGVuZXIoKTtcbiAgfVxuXG4gIGRlc3Ryb3lQYXN0ZUxpc3RlbmVyKCkge1xuICAgIGlmICh0aGlzLnBhc3RlQ2FwdHVyZXIpIHtcbiAgICAgIHdpbmRvdy5yZW1vdmVFdmVudExpc3RlbmVyKCdwYXN0ZScsIHRoaXMucGFzdGVDYXB0dXJlcik7XG4gICAgICBkZWxldGUgdGhpcy5wYXN0ZUNhcHR1cmVyO1xuICAgIH1cbiAgfVxuXG4gIHBhcmFtRmlsZUVsbSgpe1xuICAgIGlmKCB0aGlzLmZpbGVFbG0gKXJldHVybiB0aGlzLmZpbGVFbG0gLy8gYWxyZWFkeSBkZWZpbmVkXG5cbiAgICAvLyBlbG0gYWxyZWFkeSBpcyBhIGZpbGUgaW5wdXRcbiAgICBjb25zdCBpc0ZpbGUgPSBpc0ZpbGVJbnB1dCggdGhpcy5lbGVtZW50Lm5hdGl2ZUVsZW1lbnQgKVxuICAgIGlmKGlzRmlsZSl7XG4gICAgICByZXR1cm4gdGhpcy5maWxlRWxtID0gdGhpcy5lbGVtZW50Lm5hdGl2ZUVsZW1lbnRcbiAgICB9XG5cbiAgICAvLyB0aGUgaG9zdCBlbG0gaXMgTk9UIGEgZmlsZSBpbnB1dFxuICAgIHJldHVybiB0aGlzLmZpbGVFbG0gPSBjcmVhdGVGaWxlRWxtKHtcbiAgICAgIGNoYW5nZTogdGhpcy5jaGFuZ2VGbi5iaW5kKHRoaXMpXG4gICAgfSlcbiAgfVxuXG4gIGVuYWJsZVNlbGVjdGluZygpe1xuICAgIGxldCBlbG0gPSB0aGlzLmVsZW1lbnQubmF0aXZlRWxlbWVudFxuXG4gICAgaWYoIGlzRmlsZUlucHV0KGVsbSkgKXtcbiAgICAgIGNvbnN0IGJpbmRlZEhhbmRsZXIgPSBldmVudCA9PiB0aGlzLmJlZm9yZVNlbGVjdChldmVudClcbiAgICAgIGVsbS5hZGRFdmVudExpc3RlbmVyKCdjbGljaycsIGJpbmRlZEhhbmRsZXIpXG4gICAgICBlbG0uYWRkRXZlbnRMaXN0ZW5lcigndG91Y2hzdGFydCcsIGJpbmRlZEhhbmRsZXIpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBjb25zdCBiaW5kZWRIYW5kbGVyID0gZXYgPT4gdGhpcy5jbGlja0hhbmRsZXIoZXYpXG4gICAgZWxtLmFkZEV2ZW50TGlzdGVuZXIoJ2NsaWNrJywgYmluZGVkSGFuZGxlcilcbiAgICBlbG0uYWRkRXZlbnRMaXN0ZW5lcigndG91Y2hzdGFydCcsIGJpbmRlZEhhbmRsZXIpXG4gICAgZWxtLmFkZEV2ZW50TGlzdGVuZXIoJ3RvdWNoZW5kJywgYmluZGVkSGFuZGxlcilcbiAgfVxuXG4gIGdldFZhbGlkRmlsZXMoIGZpbGVzOkZpbGVbXSApOkZpbGVbXXtcbiAgICBjb25zdCBydG46RmlsZVtdID0gW11cbiAgICBmb3IobGV0IHg9ZmlsZXMubGVuZ3RoLTE7IHggPj0gMDsgLS14KXtcbiAgICAgIGlmKCB0aGlzLmlzRmlsZVZhbGlkKGZpbGVzW3hdKSApe1xuICAgICAgICBydG4ucHVzaCggZmlsZXNbeF0gKVxuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gcnRuXG4gIH1cblxuICBnZXRJbnZhbGlkRmlsZXMoZmlsZXM6RmlsZVtdKTpJbnZhbGlkRmlsZUl0ZW1bXXtcbiAgICBjb25zdCBydG46SW52YWxpZEZpbGVJdGVtW10gPSBbXVxuICAgIGZvcihsZXQgeD1maWxlcy5sZW5ndGgtMTsgeCA+PSAwOyAtLXgpe1xuICAgICAgbGV0IGZhaWxSZWFzb24gPSB0aGlzLmdldEZpbGVGaWx0ZXJGYWlsTmFtZShmaWxlc1t4XSlcbiAgICAgIGlmKCBmYWlsUmVhc29uICl7XG4gICAgICAgIHJ0bi5wdXNoKHtcbiAgICAgICAgICBmaWxlIDogZmlsZXNbeF0sXG4gICAgICAgICAgdHlwZSA6IGZhaWxSZWFzb25cbiAgICAgICAgfSlcbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIHJ0blxuICB9XG5cbiAgLy8gUHJpbWFyeSBoYW5kbGVyIG9mIGZpbGVzIGNvbWluZyBpblxuICBoYW5kbGVGaWxlcyhmaWxlczpGaWxlW10pe1xuICAgIGNvbnN0IHZhbGlkcyA9IHRoaXMuZ2V0VmFsaWRGaWxlcyhmaWxlcylcblxuICAgIGlmKGZpbGVzLmxlbmd0aCE9dmFsaWRzLmxlbmd0aCl7XG4gICAgICB0aGlzLmxhc3RJbnZhbGlkcyA9IHRoaXMuZ2V0SW52YWxpZEZpbGVzKGZpbGVzKVxuICAgIH1lbHNle1xuICAgICAgZGVsZXRlIHRoaXMubGFzdEludmFsaWRzXG4gICAgfVxuXG4gICAgdGhpcy5sYXN0SW52YWxpZHNDaGFuZ2UuZW1pdCh0aGlzLmxhc3RJbnZhbGlkcylcblxuICAgIGlmKCB2YWxpZHMubGVuZ3RoICl7XG4gICAgICBpZiggdGhpcy5uZ2ZGaXhPcmllbnRhdGlvbiApe1xuICAgICAgICB0aGlzLmFwcGx5RXhpZlJvdGF0aW9ucyh2YWxpZHMpXG4gICAgICAgIC50aGVuKCBmaXhlZEZpbGVzPT50aGlzLnF1ZShmaXhlZEZpbGVzKSApXG4gICAgICB9ZWxzZXtcbiAgICAgICAgdGhpcy5xdWUodmFsaWRzKVxuICAgICAgfVxuICAgIH1cblxuICAgIGlmICh0aGlzLmlzRW1wdHlBZnRlclNlbGVjdGlvbigpKSB7XG4gICAgICB0aGlzLmVsZW1lbnQubmF0aXZlRWxlbWVudC52YWx1ZSA9ICcnXG4gICAgfVxuICB9XG5cbiAgcXVlKCBmaWxlczpGaWxlW10gKXtcbiAgICB0aGlzLmZpbGVzID0gdGhpcy5maWxlcyB8fCBbXVxuICAgIEFycmF5LnByb3RvdHlwZS5wdXNoLmFwcGx5KHRoaXMuZmlsZXMsIGZpbGVzKVxuXG4gICAgLy9iZWxvdyBicmVhayBtZW1vcnkgcmVmIGFuZCBkb2VzbnQgYWN0IGxpa2UgYSBxdWVcbiAgICAvL3RoaXMuZmlsZXMgPSBmaWxlcy8vY2F1c2VzIG1lbW9yeSBjaGFuZ2Ugd2hpY2ggdHJpZ2dlcnMgYmluZGluZ3MgbGlrZSA8bmdmRm9ybURhdGEgW2ZpbGVzXT1cImZpbGVzXCI+PC9uZ2ZGb3JtRGF0YT5cblxuICAgIHRoaXMuZmlsZXNDaGFuZ2UuZW1pdCggdGhpcy5maWxlcyApXG5cbiAgICBpZihmaWxlcy5sZW5ndGgpe1xuICAgICAgdGhpcy5maWxlQ2hhbmdlLmVtaXQoIHRoaXMuZmlsZT1maWxlc1swXSApXG5cbiAgICAgIGlmKHRoaXMubGFzdEJhc2VVcmxDaGFuZ2Uub2JzZXJ2ZXJzLmxlbmd0aCl7XG4gICAgICAgIGRhdGFVcmwoIGZpbGVzWzBdIClcbiAgICAgICAgLnRoZW4oIHVybD0+dGhpcy5sYXN0QmFzZVVybENoYW5nZS5lbWl0KHVybCkgKVxuICAgICAgfVxuICAgIH1cblxuICAgIC8vd2lsbCBiZSBjaGVja2VkIGZvciBpbnB1dCB2YWx1ZSBjbGVhcmluZ1xuICAgIHRoaXMubGFzdEZpbGVDb3VudCA9IHRoaXMuZmlsZXMubGVuZ3RoXG4gIH1cblxuICAvKiogY2FsbGVkIHdoZW4gaW5wdXQgaGFzIGZpbGVzICovXG4gIGNoYW5nZUZuKGV2ZW50OmFueSkge1xuICAgIHZhciBmaWxlTGlzdCA9IGV2ZW50Ll9fZmlsZXNfIHx8IChldmVudC50YXJnZXQgJiYgZXZlbnQudGFyZ2V0LmZpbGVzKVxuXG4gICAgaWYgKCFmaWxlTGlzdCkgcmV0dXJuO1xuXG4gICAgdGhpcy5zdG9wRXZlbnQoZXZlbnQpO1xuICAgIHRoaXMuaGFuZGxlRmlsZXMoZmlsZUxpc3QpXG4gIH1cblxuICBjbGlja0hhbmRsZXIoZXZ0OiBFdmVudCl7XG4gICAgY29uc3QgZWxtID0gdGhpcy5lbGVtZW50Lm5hdGl2ZUVsZW1lbnRcbiAgICBpZiAoZWxtLmdldEF0dHJpYnV0ZSgnZGlzYWJsZWQnKSB8fCB0aGlzLmZpbGVEcm9wRGlzYWJsZWQpe1xuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cblxuICAgIHZhciByID0gZGV0ZWN0U3dpcGUoZXZ0KTtcbiAgICAvLyBwcmV2ZW50IHRoZSBjbGljayBpZiBpdCBpcyBhIHN3aXBlXG4gICAgaWYgKCByIT09ZmFsc2UgKSByZXR1cm4gcjtcblxuICAgIGNvbnN0IGZpbGVFbG0gPSB0aGlzLnBhcmFtRmlsZUVsbSgpXG4gICAgZmlsZUVsbS5jbGljaygpXG4gICAgLy9maWxlRWxtLmRpc3BhdGNoRXZlbnQoIG5ldyBFdmVudCgnY2xpY2snKSApO1xuICAgIHRoaXMuYmVmb3JlU2VsZWN0KGV2dClcblxuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuXG4gIGJlZm9yZVNlbGVjdChldmVudDogRXZlbnQpe1xuICAgIHRoaXMuZmlsZVNlbGVjdFN0YXJ0LmVtaXQoZXZlbnQpXG5cbiAgICBpZiggdGhpcy5maWxlcyAmJiB0aGlzLmxhc3RGaWxlQ291bnQ9PT10aGlzLmZpbGVzLmxlbmd0aCApcmV0dXJuXG5cbiAgICAvLyBpZiBubyBmaWxlcyBpbiBhcnJheSwgYmUgc3VyZSBicm93c2VyIGRvZXMgbm90IHByZXZlbnQgcmVzZWxlY3Qgb2Ygc2FtZSBmaWxlIChzZWUgZ2l0aHViIGlzc3VlIDI3KVxuICAgIHRoaXMuY2xlYXJGaWxlRWxtVmFsdWUoKVxuICB9XG5cbiAgY2xlYXJGaWxlRWxtVmFsdWUoKSB7XG4gICAgdGhpcy5maWxlRWxtLnZhbHVlID0gbnVsbFxuICB9XG5cbiAgaXNFbXB0eUFmdGVyU2VsZWN0aW9uKCk6Ym9vbGVhbiB7XG4gICAgcmV0dXJuICEhdGhpcy5lbGVtZW50Lm5hdGl2ZUVsZW1lbnQuYXR0cmlidXRlcy5tdWx0aXBsZTtcbiAgfVxuXG4gIHN0b3BFdmVudChldmVudDphbnkpOmFueSB7XG4gICAgZXZlbnQucHJldmVudERlZmF1bHQoKTtcbiAgICBldmVudC5zdG9wUHJvcGFnYXRpb24oKTtcbiAgfVxuXG4gIHRyYW5zZmVySGFzRmlsZXModHJhbnNmZXI6YW55KTphbnkge1xuICAgIGlmICghdHJhbnNmZXIudHlwZXMpIHtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG5cbiAgICBpZiAodHJhbnNmZXIudHlwZXMuaW5kZXhPZikge1xuICAgICAgcmV0dXJuIHRyYW5zZmVyLnR5cGVzLmluZGV4T2YoJ0ZpbGVzJykgIT09IC0xO1xuICAgIH0gZWxzZSBpZiAodHJhbnNmZXIudHlwZXMuY29udGFpbnMpIHtcbiAgICAgIHJldHVybiB0cmFuc2Zlci50eXBlcy5jb250YWlucygnRmlsZXMnKTtcbiAgICB9IGVsc2Uge1xuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgfVxuXG4gIGV2ZW50VG9GaWxlcyhldmVudDpFdmVudCl7XG4gICAgY29uc3QgdHJhbnNmZXIgPSBldmVudFRvVHJhbnNmZXIoZXZlbnQpO1xuICAgIGlmKCB0cmFuc2ZlciApe1xuICAgICAgaWYodHJhbnNmZXIuZmlsZXMgJiYgdHJhbnNmZXIuZmlsZXMubGVuZ3RoKXtcbiAgICAgICAgcmV0dXJuIHRyYW5zZmVyLmZpbGVzXG4gICAgICB9XG4gICAgICBpZih0cmFuc2Zlci5pdGVtcyAmJiB0cmFuc2Zlci5pdGVtcy5sZW5ndGgpe1xuICAgICAgICByZXR1cm4gdHJhbnNmZXIuaXRlbXNcbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIFtdXG4gIH1cblxuICBhcHBseUV4aWZSb3RhdGlvbnMoXG4gICAgZmlsZXM6RmlsZVtdXG4gICk6UHJvbWlzZTxGaWxlW10+e1xuICAgIGNvbnN0IG1hcHBlciA9IChcbiAgICAgIGZpbGU6RmlsZSxpbmRleDpudW1iZXJcbiAgICApOlByb21pc2U8YW55Pj0+e1xuICAgICAgcmV0dXJuIGFwcGx5RXhpZlJvdGF0aW9uKGZpbGUpXG4gICAgICAudGhlbiggZml4ZWRGaWxlPT5maWxlcy5zcGxpY2UoaW5kZXgsIDEsIGZpeGVkRmlsZSkgKVxuICAgIH1cblxuICAgIGNvbnN0IHByb21zOlByb21pc2U8YW55PltdID0gW11cbiAgICBmb3IobGV0IHg9ZmlsZXMubGVuZ3RoLTE7IHggPj0gMDsgLS14KXtcbiAgICAgIHByb21zW3hdID0gbWFwcGVyKCBmaWxlc1t4XSwgeCApXG4gICAgfVxuICAgIHJldHVybiBQcm9taXNlLmFsbCggcHJvbXMgKS50aGVuKCAoKT0+ZmlsZXMgKVxuICB9XG5cbiAgQEhvc3RMaXN0ZW5lcignY2hhbmdlJywgWyckZXZlbnQnXSlcbiAgb25DaGFuZ2UoZXZlbnQ6RXZlbnQpOnZvaWQge1xuICAgIGxldCBmaWxlcyA9IHRoaXMuZWxlbWVudC5uYXRpdmVFbGVtZW50LmZpbGVzIHx8IHRoaXMuZXZlbnRUb0ZpbGVzKGV2ZW50KVxuXG4gICAgaWYoIWZpbGVzLmxlbmd0aClyZXR1cm5cblxuICAgIHRoaXMuc3RvcEV2ZW50KGV2ZW50KTtcbiAgICB0aGlzLmhhbmRsZUZpbGVzKGZpbGVzKVxuICB9XG5cbiAgZ2V0RmlsZUZpbHRlckZhaWxOYW1lKFxuICAgIGZpbGU6RmlsZVxuICApOnN0cmluZyB8IHVuZGVmaW5lZHtcbiAgICBmb3IobGV0IGkgPSAwOyBpIDwgdGhpcy5maWx0ZXJzLmxlbmd0aDsgaSsrKXtcbiAgICAgIGlmKCAhdGhpcy5maWx0ZXJzW2ldLmZuLmNhbGwodGhpcywgZmlsZSkgKXtcbiAgICAgICAgcmV0dXJuIHRoaXMuZmlsdGVyc1tpXS5uYW1lXG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiB1bmRlZmluZWRcbiAgfVxuXG4gIGlzRmlsZVZhbGlkKGZpbGU6RmlsZSk6Ym9vbGVhbntcbiAgICBjb25zdCBub0ZpbHRlcnMgPSAhdGhpcy5hY2NlcHQgJiYgKCF0aGlzLmZpbHRlcnMgfHwgIXRoaXMuZmlsdGVycy5sZW5ndGgpXG4gICAgaWYoIG5vRmlsdGVycyApe1xuICAgICAgcmV0dXJuIHRydWUvL3dlIGhhdmUgbm8gZmlsdGVycyBzbyBhbGwgZmlsZXMgYXJlIHZhbGlkXG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuZ2V0RmlsZUZpbHRlckZhaWxOYW1lKGZpbGUpID8gZmFsc2UgOiB0cnVlXG4gIH1cblxuICBpc0ZpbGVzVmFsaWQoZmlsZXM6RmlsZVtdKXtcbiAgICBmb3IobGV0IHg9ZmlsZXMubGVuZ3RoLTE7IHggPj0gMDsgLS14KXtcbiAgICAgIGlmKCAhdGhpcy5pc0ZpbGVWYWxpZChmaWxlc1t4XSkgKXtcbiAgICAgICAgcmV0dXJuIGZhbHNlXG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiB0cnVlXG4gIH1cblxuICBwcm90ZWN0ZWQgX2FjY2VwdEZpbHRlcihpdGVtOkZpbGUpOmJvb2xlYW4ge1xuICAgIHJldHVybiBhY2NlcHRUeXBlKHRoaXMuYWNjZXB0LCBpdGVtLnR5cGUsIGl0ZW0ubmFtZSlcbiAgfVxuXG4gIHByb3RlY3RlZCBfZmlsZVNpemVGaWx0ZXIoaXRlbTpGaWxlKTpib29sZWFuIHtcbiAgICByZXR1cm4gISh0aGlzLm1heFNpemUgJiYgaXRlbS5zaXplID4gdGhpcy5tYXhTaXplKTtcbiAgfVxufVxuXG5cbi8qKiBicm93c2VycyB0cnkgaGFyZCB0byBjb25jZWFsIGRhdGEgYWJvdXQgZmlsZSBkcmFncywgdGhpcyB0ZW5kcyB0byB1bmRvIHRoYXQgKi9cbmV4cG9ydCBmdW5jdGlvbiBmaWxlc1RvV3JpdGVhYmxlT2JqZWN0KCBmaWxlczpGaWxlW10gKTpkcmFnTWV0YVtde1xuICBjb25zdCBqc29uRmlsZXM6ZHJhZ01ldGFbXSA9IFtdXG4gIGZvcihsZXQgeD0wOyB4IDwgZmlsZXMubGVuZ3RoOyArK3gpe1xuICAgIGpzb25GaWxlcy5wdXNoKHtcbiAgICAgIHR5cGU6ZmlsZXNbeF0udHlwZSxcbiAgICAgIGtpbmQ6ZmlsZXNbeF1bXCJraW5kXCJdXG4gICAgfSlcbiAgfVxuICByZXR1cm4ganNvbkZpbGVzXG59XG5cbi8qKiBPbmx5IHVzZWQgd2hlbiBob3N0IGVsZW1lbnQgd2UgYXJlIGF0dGFjaGVkIHRvIGlzIE5PVCBhIGZpbGVFbGVtZW50ICovXG5mdW5jdGlvbiBjcmVhdGVGaWxlRWxtKHtjaGFuZ2V9OiB7Y2hhbmdlOigpID0+IGFueX0pIHtcbiAgLy8gdXNlIHNwZWNpZmljIHRlY2huaXF1ZSB0byBoaWRlIGZpbGUgZWxlbWVudCB3aXRoaW5cbiAgY29uc3QgbGFiZWwgPSBjcmVhdGVJbnZpc2libGVGaWxlSW5wdXRXcmFwKClcblxuICB0aGlzLmZpbGVFbG0gPSBsYWJlbC5nZXRFbGVtZW50c0J5VGFnTmFtZSgnaW5wdXQnKVswXVxuICB0aGlzLmZpbGVFbG0uYWRkRXZlbnRMaXN0ZW5lcignY2hhbmdlJywgY2hhbmdlKTtcblxuICByZXR1cm4gdGhpcy5lbGVtZW50Lm5hdGl2ZUVsZW1lbnQuYXBwZW5kQ2hpbGQoIGxhYmVsICkgLy8gcHV0IG9uIGh0bWwgc3RhZ2Vcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGV2ZW50VG9UcmFuc2ZlcihldmVudDogYW55KTogVHJhbnNmZXJPYmplY3Qge1xuICBpZihldmVudC5kYXRhVHJhbnNmZXIpcmV0dXJuIGV2ZW50LmRhdGFUcmFuc2ZlclxuICByZXR1cm4gIGV2ZW50Lm9yaWdpbmFsRXZlbnQgPyBldmVudC5vcmlnaW5hbEV2ZW50LmRhdGFUcmFuc2ZlciA6IG51bGxcbn1cblxuXG5pbnRlcmZhY2UgVHJhbnNmZXJPYmplY3Qge1xuICBpdGVtcz86IGFueVtdXG4gIGZpbGVzPzogYW55W11cbiAgZHJvcEVmZmVjdD86ICdjb3B5JyAvLyBodHRwczovL2RldmVsb3Blci5tb3ppbGxhLm9yZy9lbi1VUy9kb2NzL1dlYi9BUEkvRGF0YVRyYW5zZmVyL2Ryb3BFZmZlY3Rcbn0iXX0=