export namespace main {
	
	export class Config {
	    font: string;
	    themeMode: string;
	    editorPath: string;
	
	    static createFrom(source: any = {}) {
	        return new Config(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.font = source["font"];
	        this.themeMode = source["themeMode"];
	        this.editorPath = source["editorPath"];
	    }
	}
	export class LoadResult {
	    html: string;
	    raw: string;
	
	    static createFrom(source: any = {}) {
	        return new LoadResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.html = source["html"];
	        this.raw = source["raw"];
	    }
	}

}

