// pathfinder/client/src/benchmark.ts
//
// Copyright © 2017 The Pathfinder Project Developers.
//
// Licensed under the Apache License, Version 2.0 <LICENSE-APACHE or
// http://www.apache.org/licenses/LICENSE-2.0> or the MIT license
// <LICENSE-MIT or http://opensource.org/licenses/MIT>, at your
// option. This file may not be copied, modified, or distributed
// except according to those terms.

import * as glmatrix from 'gl-matrix';
import * as opentype from "opentype.js";

import { AppController, DemoAppController } from "./app-controller";
import {PathfinderMeshData} from "./meshes";
import { BUILTIN_FONT_URI, GlyphStorage, PathfinderGlyph, TextFrame, TextRun, ExpandedMeshData } from "./text";
import { assert, unwrapNull, PathfinderError } from "./utils";
import { PathfinderDemoView, Timings } from "./view";
import { ShaderMap, ShaderProgramSource } from "./shader-loader";
import { AntialiasingStrategy, AntialiasingStrategyName, NoAAStrategy } from "./aa-strategy";
import SSAAStrategy from './ssaa-strategy';
import { OrthographicCamera } from './camera';

const STRING: string = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

const FONT: string = 'nimbus-sans';

const TEXT_COLOR: number[] = [0, 0, 0, 255];

const MIN_FONT_SIZE: number = 6;
const MAX_FONT_SIZE: number = 200;

const ANTIALIASING_STRATEGIES: AntialiasingStrategyTable = {
    none: NoAAStrategy,
    ssaa: SSAAStrategy,
};

interface ElapsedTime {
    size: number;
    time: number;
}

interface AntialiasingStrategyTable {
    none: typeof NoAAStrategy;
    ssaa: typeof SSAAStrategy;
}

class BenchmarkAppController extends DemoAppController<BenchmarkTestView> {
    start() {
        super.start();

        const runBenchmarkButton = unwrapNull(document.getElementById('pf-run-benchmark-button'));
        runBenchmarkButton.addEventListener('click', () => this.runBenchmark(), false);

        this.loadInitialFile();
    }

    protected fileLoaded(): void {
        const font = opentype.parse(this.fileData);
        this.font = font;
        assert(this.font.isSupported(), "The font type is unsupported!");

        const createGlyph = (glyph: opentype.Glyph) => new BenchmarkGlyph(glyph);
        const textRun = new TextRun<BenchmarkGlyph>(STRING, [0, 0], font, createGlyph);
        this.textRun = textRun;
        const textFrame = new TextFrame([textRun], font);
        this.glyphStorage = new GlyphStorage(this.fileData, [textFrame], createGlyph, font);

        this.glyphStorage.partition().then(baseMeshes => {
            this.baseMeshes = baseMeshes;
            const expandedMeshes = this.glyphStorage.expandMeshes(baseMeshes)[0];
            this.expandedMeshes = expandedMeshes;
            this.view.then(view => {
                view.uploadPathColors(1);
                view.uploadPathTransforms(1);
                view.attachMeshes([expandedMeshes.meshes]);
            })
        })
    }

    protected createView(): BenchmarkTestView {
        return new BenchmarkTestView(this,
                                     unwrapNull(this.commonShaderSource),
                                     unwrapNull(this.shaderSources));
    }

    private runBenchmark(): void {
        this.pixelsPerEm = MIN_FONT_SIZE;
        this.elapsedTimes = [];
        this.view.then(view => this.runOneBenchmarkTest(view));
    }

    private runOneBenchmarkTest(view: BenchmarkTestView): void {
        const renderedPromise = new Promise<number>((resolve, reject) => {
            view.renderingPromiseCallback = resolve;
            view.pixelsPerEm = this.pixelsPerEm;
        });
        renderedPromise.then(elapsedTime => {
            this.elapsedTimes.push({ size: this.pixelsPerEm, time: elapsedTime });

            if (this.pixelsPerEm == MAX_FONT_SIZE) {
                console.info(this.elapsedTimes);
                return;
            }

            this.pixelsPerEm++;
            this.runOneBenchmarkTest(view);
        });
    }

    protected readonly defaultFile: string = FONT;
    protected readonly builtinFileURI: string = BUILTIN_FONT_URI;

    private glyphStorage: GlyphStorage<BenchmarkGlyph>;
    private baseMeshes: PathfinderMeshData;
    private expandedMeshes: ExpandedMeshData;

    private pixelsPerEm: number;
    private elapsedTimes: ElapsedTime[];

    font: opentype.Font | null;
    textRun: TextRun<BenchmarkGlyph> | null;
}
    
class BenchmarkTestView extends PathfinderDemoView {
    constructor(appController: BenchmarkAppController,
                commonShaderSource: string,
                shaderSources: ShaderMap<ShaderProgramSource>) {
        super(commonShaderSource, shaderSources);

        this.appController = appController;

        this.camera = new OrthographicCamera(this.canvas);
        this.camera.onPan = () => this.setDirty();
        this.camera.onZoom = () => this.setDirty();
    }

    protected createAAStrategy(aaType: AntialiasingStrategyName,
                               aaLevel: number,
                               subpixelAA: boolean):
                               AntialiasingStrategy {
        if (aaType !== 'ecaa')
            return new (ANTIALIASING_STRATEGIES[aaType])(aaLevel, subpixelAA);
        throw new PathfinderError("Unsupported antialiasing type!");
    }

    protected compositeIfNecessary(): void {}

    protected updateTimings(timings: Timings): void {
        // TODO(pcwalton)
    }

    protected pathColorsForObject(objectIndex: number): Uint8Array {
        const pathColors = new Uint8Array(4 * (STRING.length + 1));
        for (let pathIndex = 0; pathIndex < STRING.length; pathIndex++)
            pathColors.set(TEXT_COLOR, (pathIndex + 1) * 4);
        return pathColors;
    }

    protected pathTransformsForObject(objectIndex: number): Float32Array {
        const pathTransforms = new Float32Array(4 * (STRING.length + 1));
        let currentX = 0;

        for (let glyphIndex = 0; glyphIndex < STRING.length; glyphIndex++) {
            const glyph = unwrapNull(this.appController.textRun).glyphs[glyphIndex];
            pathTransforms.set([1, 1, currentX, 0], (glyphIndex + 1) * 4);
            currentX += glyph.advanceWidth;
        }

        return pathTransforms;
    }

    protected renderingFinished(): void {
        if (this.renderingPromiseCallback != null)
            this.renderingPromiseCallback(this.lastTimings.atlasRendering);
    }

    destFramebuffer: WebGLFramebuffer | null = null;

    get destAllocatedSize(): glmatrix.vec2 {
        return glmatrix.vec2.clone([this.canvas.width, this.canvas.height]);
    }

    get destUsedSize(): glmatrix.vec2 {
        return this.destAllocatedSize;
    }

    private readonly appController: BenchmarkAppController;

    protected usedSizeFactor: glmatrix.vec2 = glmatrix.vec2.clone([1.0, 1.0]);

    protected get worldTransform() {
        const transform = glmatrix.mat4.create();
        const translation = this.camera.translation;
        glmatrix.mat4.fromTranslation(transform, [translation[0], translation[1], 0]);
        glmatrix.mat4.scale(transform, transform, [this.camera.scale, this.camera.scale, 1.0]);

        const pixelsPerUnit = this._pixelsPerEm / unwrapNull(this.appController.font).unitsPerEm;
        glmatrix.mat4.scale(transform, transform, [pixelsPerUnit, pixelsPerUnit, 1.0]);

        return transform;
    }

    get pixelsPerEm(): number {
        return this._pixelsPerEm;
    }

    set pixelsPerEm(newPixelsPerEm: number) {
        this._pixelsPerEm = newPixelsPerEm;
        this.setDirty();
    }

    renderingPromiseCallback: ((time: number) => void) | null;

    private _pixelsPerEm: number = 32.0;

    protected directCurveProgramName: keyof ShaderMap<void> = 'directCurve';
    protected directInteriorProgramName: keyof ShaderMap<void> = 'directInterior';

    protected depthFunction: number = this.gl.GREATER;

    protected camera: OrthographicCamera;
}

class BenchmarkGlyph extends PathfinderGlyph {}

function main() {
    const controller = new BenchmarkAppController;
    window.addEventListener('load', () => controller.start(), false);
}

main();
