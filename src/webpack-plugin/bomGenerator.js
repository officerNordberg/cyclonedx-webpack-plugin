/*
 * This file is part of CycloneDX Webpack plugin.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * SPDX-License-Identifier: Apache-2.0
 * Copyright (c) OWASP Foundation. All Rights Reserved.
 */
const readPkgUp = require('read-pkg-up');
const { PackageURL } = require('packageurl-js');
const Bom = require('@cyclonedx/bom/model/Bom');
const Component = require('@cyclonedx/bom/model/Component');
const Dependency = require('@cyclonedx/bom/model/Dependency');
const Metadata = require('@cyclonedx/bom/model/Metadata');
const Tool = require('@cyclonedx/bom/model/Tool');
const program = require('../../package.json');

/**
 * Create a CycloneDX SBOM from stats modules generated by webpack
 * @param {any[]} modules modules from webpack
 * @param {any} defaultModule fallback module to generate if webpack found no dependencies (the root module)
 * @returns {Bom} bom generated from webpack modules
 */
const resolveComponents = async function(modules = [], defaultModule = {}) {

    /**
     * Construct an SBOM using the webpack stats modules
     * @param {Bom} bom the dependency tree to populate
     */
    const buildBom = async function(bom) {
        let bomRefLookup = [];
        let pkgDependencies = [];

        for (const moduleData of modules) {

            /**
             * Dependencies that are from node or listed in the `externals` portion of your webpack config
             * will not be included in the dependency manifest.
             *
             * https://webpack.js.org/configuration/externals/
             */
            if (!moduleData.issuer || !moduleData.resource) {
                continue;
            }

            const {issuer: {resource: requester}, resource: dependency} = moduleData;
            const ignoredMatcher = /^ignored|^external/g;
            // If there's no requester or the dependency or requester is ignored or marked as external by webpack
            // then this dependency is skipped.
            if (!requester || !dependency || ignoredMatcher.test(requester) || ignoredMatcher.test(requester))
                continue;

            // Get the requester package.json and dependency package.json
            let requesterPkg, dependencyPkg;
            try {
                requesterPkg = await readPkgUp({cwd: requester});
                dependencyPkg = await readPkgUp({cwd: dependency});
            } catch (err) {
                // eslint-disable-next-line no-console
                console.info(err);
            }

            if (requesterPkg && dependencyPkg) {
                const {package: requesterPackage, path: requesterPath} = requesterPkg;
                const {package: dependencyPackage, path: dependencyPath} = dependencyPkg;

                if (requesterPackage.name === "popper.js" || dependencyPackage.name === "popper.js") {
                    console.log(requesterPackage.name + " / " + dependencyPackage.name);
                }

                let requesterBomRef = toPackageURL(requesterPackage);
                let dependencyBomRef = toPackageURL(dependencyPackage);
                if (bomRefLookup.includes(requesterBomRef)) {
                    // add the location of the requester if it exists already.
                    // it might be the same dependency in multiple places.
                    //requesterNode.addLocation(requesterPath);
                    // TODO: retrieve the dependency from the BOM and add the dependencyPackage to it
                } else {
                    /*
                    let component = new Component(requesterPackage);
                    bom.addComponent(component);
                    let dependency = new Dependency(component.bomRef);
                    bom.addDependency(dependency);
                    bomRefLookup.push(requesterBomRef);
                     */
                }
                if (bomRefLookup.includes(dependencyBomRef)) {

                } else {
                    let component = new Component(dependencyPackage);
                    bom.addComponent(component);

                    let dr = findDependencyByRef(requesterBomRef);
                    if (! dr) {
                        dr = new Dependency(requesterBomRef);
                        bom.addDependency(dr);
                    }


                    let dd = findDependencyByRef(dependencyBomRef);
                    if (dd) {

                    } else {
                        let dependency = new Dependency(component.bomRef);
                        bom.addDependency(dependency);
                        if (dr && dd !== dr) {
                            if (! dr._dependencies) dr._dependencies = [];
                            dr._dependencies.push(dependency);
                        }
                    }


                    bomRefLookup.push(dependencyBomRef);
                }
                // relate the dependency and the requester.
                // requester -depends on-> dependency
                // dependency -is required by-> requester
                //requesterNode.addDependency(dependencyNode);
                //dependencyNode.addRequiredBy(requesterNode);
            }
        }
    };

    const findDependencyByRef = function (ref) {
        for (let d in bom.dependencies) {
            if (d.ref && d.ref === ref) {
                return d;
            }
        }
        return undefined;
    }

    const isComponentMetadataRoot = function (module) {
        let bomRef = toPackageURL(module);
        return bom.metadata && bom.metadata.component && bom.metadata.component.bomRef === bomRef;
    }

    const isComponentInBom = function (module) {
        let bomRef = toPackageURL(module);
        for (let c in bom.components) {
            if (c.bomRef === bomRef) {
                return true;
            }
        }
        return false;
    }

    const toPackageURL = function (module) {
        if (!module.name) return undefined;
        let group = (module.scope) ? module.scope : undefined;
        if (group) group = '@' + group;
        return new PackageURL('npm', group, module.name, module.version, null, null).toString();
    }

    /**
     * Finds the roots for a dependency tree by examining the `DependencyNodes` in its' `lookupMap`
     * @param {DependencyTree} dependencyTree the dependency tree to find the roots for
     */
    const findRoots = function (dependencyTree) {
        const {lookupMap} = dependencyTree.getData();
        // Get the list of dependencies by name
        for (const dependencyName of Object.keys(lookupMap)) {
            // Get the list of each dependency's versions
            for (const dependencyVersion of Object.keys(lookupMap[dependencyName].versions)) {
                const node = lookupMap[dependencyName].versions[dependencyVersion];
                const {requiredBy, locations} = node.getData();
                // If the dependency node is required by nothing it's a root package
                const rootNode = requiredBy.length === 0 && locations.some(function (location) {
                    return !location.includes('node_modules');
                });

                if (rootNode) {
                    // set the dependency as a root package and add it to the tree's roots.
                    node.setRootPackage(rootNode);
                    dependencyTree.addRoot(node);
                }
            }
        }
    };

    const bom = new Bom();
    let tool = new Tool("CycloneDX", "webpack-plugin", program.version);
    let metadata = new Metadata();
    metadata.tools = [tool];
    bom.metadata = metadata;

    await buildBom(bom);
    return bom;
};

module.exports = {resolveComponents};
