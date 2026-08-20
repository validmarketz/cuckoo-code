#!/usr/bin/env python3

"""Generate an AI-friendly Markdown map of a source-code project.

The document contains a compact project overview, a complete file/symbol index,
and bounded source excerpts.  It uses only Python's standard library.

Examples:
    py generate-docs.py -h
    py generate-docs.py C:\\UniServerZ\\www\\holoo\\HolooV1.4 --output ai-context.md
    py generate-docs.py . --max-source-chars 8000 --output PROJECT_CONTEXT.md
    py generate-docs.py . --no-source --exclude-dir legacy --exclude-path app/cache
"""

from __future__ import annotations

import argparse
import ast
import datetime as dt
import io
import json
import os
import re
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any, Callable, Dict, Iterable, List, Optional, Sequence, Tuple


# Keep console output readable on Windows, including projects with non-ASCII names.
# Guarded for windowed (no-console) builds where stdout/stderr are None.
if sys.platform == "win32":
    if sys.stdout is not None:
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    if sys.stderr is not None:
        sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")


class ScanCancelled(Exception):
    """Raised when a caller-provided cancel check aborts a scan."""


class LanguageDetector:
    """Detect languages and a small set of common frameworks."""

    LANGUAGE_RULES = {
        "Python": {"extensions": [".py", ".pyw", ".pyx", ".pyi"], "files": ["requirements.txt", "setup.py", "pyproject.toml", "Pipfile", "poetry.lock"], "shebang": ["python", "python3"]},
        "JavaScript": {"extensions": [".js", ".jsx", ".mjs", ".cjs"], "files": ["package.json", "package-lock.json", "yarn.lock"], "shebang": ["node"]},
        "TypeScript": {"extensions": [".ts", ".tsx"], "files": ["tsconfig.json", "package.json"]},
        "Rust": {"extensions": [".rs"], "files": ["Cargo.toml", "Cargo.lock"]},
        "Go": {"extensions": [".go"], "files": ["go.mod", "go.sum"]},
        "Java": {"extensions": [".java", ".class", ".jar"], "files": ["pom.xml", "build.gradle", "build.gradle.kts"]},
        "Kotlin": {"extensions": [".kt", ".kts"], "files": ["build.gradle.kts"]},
        "Scala": {"extensions": [".scala", ".sbt"], "files": ["build.sbt"]},
        "Ruby": {"extensions": [".rb", ".rake", ".gemfile"], "files": ["Gemfile", "Gemfile.lock", "Rakefile"]},
        "PHP": {"extensions": [".php", ".phtml"], "files": ["composer.json", "composer.lock"]},
        "Swift": {"extensions": [".swift"], "files": ["Package.swift"]},
        "Objective-C": {"extensions": [".m", ".h", ".mm"]},
        "C": {"extensions": [".c", ".h", ".hpp"], "files": ["Makefile", "CMakeLists.txt"]},
        "C++": {"extensions": [".cpp", ".cc", ".cxx", ".c++", ".hpp", ".hxx"], "files": ["Makefile", "CMakeLists.txt"]},
        "C#": {"extensions": [".cs"], "files": [".csproj", ".sln"]},
        "Dart": {"extensions": [".dart"], "files": ["pubspec.yaml", "pubspec.lock"]},
        "Flutter": {"extensions": [".dart"], "files": ["pubspec.yaml", "flutter.yaml"]},
        "React": {"extensions": [".jsx", ".tsx"], "files": ["package.json"]},
        "Vue": {"extensions": [".vue"], "files": ["package.json", "vue.config.js"]},
        "Angular": {"extensions": [".ts"], "files": ["angular.json", "package.json"]},
        "Solidity": {"extensions": [".sol"], "files": ["hardhat.config.js", "truffle-config.js", "foundry.toml"]},
        "Shell": {"extensions": [".sh", ".bash", ".zsh", ".fish"], "shebang": ["bash", "sh", "zsh", "fish"]},
        "PowerShell": {"extensions": [".ps1", ".psm1", ".psd1"]},
        "SQL": {"extensions": [".sql", ".psql"]},
        "HTML": {"extensions": [".html", ".htm", ".xhtml"]},
        "CSS": {"extensions": [".css", ".scss", ".sass", ".less"], "files": ["package.json"]},
        "Docker": {"extensions": [], "files": ["Dockerfile", "docker-compose.yml", "docker-compose.yaml"]},
        "Kubernetes": {"extensions": [".yaml", ".yml"], "files": ["deployment.yaml", "service.yaml", "ingress.yaml", "kustomization.yaml"]},
        "Terraform": {"extensions": [".tf", ".tfvars"], "files": ["main.tf", "variables.tf", "outputs.tf"]},
        "Ansible": {"extensions": [".yml", ".yaml"], "files": ["playbook.yml", "inventory.yml"]},
        "Markdown": {"extensions": [".md", ".markdown"]},
        "JSON": {"extensions": [".json"]},
        "YAML": {"extensions": [".yml", ".yaml"]},
        "TOML": {"extensions": [".toml"]},
        "XML": {"extensions": [".xml", ".xsd", ".xslt"]},
    }

    FRAMEWORK_PATTERNS = {
        "React": {"deps": ["react", "react-dom"]},
        "Vue": {"deps": ["vue"]},
        "Angular": {"deps": ["@angular/core"]},
        "Next.js": {"deps": ["next"]},
        "Nuxt": {"deps": ["nuxt"]},
        "Express": {"deps": ["express"]},
        "Django": {"deps": ["django"]},
        "Flask": {"deps": ["flask"]},
        "FastAPI": {"deps": ["fastapi"]},
        "Spring": {"deps": ["spring-boot"]},
        "Rails": {"deps": ["rails"]},
        "Laravel": {"deps": ["laravel"]},
        ".NET": {"deps": ["Microsoft.NET"]},
        "Flutter": {"deps": ["flutter"]},
        "React Native": {"deps": ["react-native"]},
        "Electron": {"deps": ["electron"]},
        "Tauri": {"deps": ["tauri"]},
    }

    @staticmethod
    def detect_by_extension(file_path: Path) -> List[str]:
        ext = file_path.suffix.lower()
        return [lang for lang, rules in LanguageDetector.LANGUAGE_RULES.items() if ext in rules.get("extensions", [])]

    @staticmethod
    def detect_by_filename(file_path: Path) -> List[str]:
        name = file_path.name
        return [lang for lang, rules in LanguageDetector.LANGUAGE_RULES.items() if name in rules.get("files", [])]

    @staticmethod
    def detect_by_shebang(file_path: Path) -> List[str]:
        try:
            with file_path.open("r", encoding="utf-8", errors="ignore") as handle:
                first_line = handle.readline().strip()
        except (OSError, UnicodeError):
            return []
        if not first_line.startswith("#!"):
            return []
        return [
            lang
            for lang, rules in LanguageDetector.LANGUAGE_RULES.items()
            if any(interpreter in first_line for interpreter in rules.get("shebang", []))
        ]

    @staticmethod
    def detect_frameworks(project_path: Path) -> Dict[str, List[str]]:
        found: Dict[str, List[str]] = defaultdict(list)

        def detect_from_package_json(pkg: Path) -> None:
            try:
                data = json.loads(pkg.read_text(encoding="utf-8", errors="ignore"))
                deps = {**data.get("dependencies", {}), **data.get("devDependencies", {})}
                for framework, rules in LanguageDetector.FRAMEWORK_PATTERNS.items():
                    if any(dep in deps for dep in rules.get("deps", [])):
                        found["Node.js"].append(framework)
            except (OSError, ValueError, TypeError):
                pass

        # Check root package.json
        package_json = project_path / "package.json"
        if package_json.exists():
            detect_from_package_json(package_json)

        # Also scan immediate subdirectories for package.json (monorepo support)
        for pkg_json in project_path.glob("*/package.json"):
            if pkg_json.exists():
                detect_from_package_json(pkg_json)

        requirements = project_path / "requirements.txt"
        setup = project_path / "setup.py"
        if requirements.exists() or setup.exists():
            try:
                names = "\n".join(
                    p.read_text(encoding="utf-8", errors="ignore").lower()
                    for p in (requirements, setup)
                    if p.exists()
                )
                if (project_path / "manage.py").exists() or "django" in names:
                    found["Python"].append("Django")
                if (project_path / "app.py").exists() or "flask" in names:
                    found["Python"].append("Flask")
                if "fastapi" in names:
                    found["Python"].append("FastAPI")
            except OSError:
                pass

        cargo = project_path / "Cargo.toml"
        if cargo.exists():
            try:
                content = cargo.read_text(encoding="utf-8", errors="ignore").lower()
                for needle, framework in (("solana", "Solana"), ("tokio", "Tokio"), ("axum", "Axum"), ("actix", "Actix")):
                    if needle in content:
                        found["Rust"].append(framework)
            except OSError:
                pass

        return {ecosystem: list(dict.fromkeys(items)) for ecosystem, items in found.items()}


# Files whose content is generated/lock data and should never be embedded as
# source — they dominate token cost on large projects (a single package-lock
# can be ~1 MB) without helping an AI understand hand-written logic.
LOCK_FILES = {
    "package-lock.json", "yarn.lock", "composer.lock", "poetry.lock",
    "gemfile.lock", "pipfile.lock", "phpunit.xml", "flake.lock", "cargo.lock",
}
DATA_EXTENSIONS = {".json", ".yaml", ".yml", ".toml", ".md", ".markdown"}

# Detail tiers: chosen automatically by project size unless overridden. Each
# tier controls how verbose the output is and caps the dominant token costs.
DETAIL_TIERS = {
    # name:       (max_source_kb_budget, symbol_cap, render_full_details)
    "full":     (0,   400, True),
    "standard": (256, 200, True),
    "minimal":  (64,  100, False),
}
DETAIL_TIER_ORDER = ("minimal", "standard", "full")


def read_text(path: Path) -> str:
    """Read text without allowing an encoding error to stop the scan."""
    return path.read_text(encoding="utf-8", errors="replace")


def line_number(content: str, position: int) -> int:
    return content.count("\n", 0, position) + 1


def first_doc_line(node: ast.AST) -> Optional[str]:
    value = ast.get_docstring(node, clean=True)
    return value.splitlines()[0][:160] if value else None


def parameter_names(arguments: ast.arguments) -> List[str]:
    values = list(arguments.posonlyargs) + list(arguments.args) + list(arguments.kwonlyargs)
    names = [arg.arg for arg in values]
    if arguments.vararg:
        names.append("*" + arguments.vararg.arg)
    if arguments.kwarg:
        names.append("**" + arguments.kwarg.arg)
    return names


def unique_strings(values: Iterable[str]) -> List[str]:
    return list(dict.fromkeys(value for value in values if value))


def bounded_excerpt(source: str, max_chars: int, language: str = "") -> Tuple[str, bool]:
    """Return a bounded excerpt of source.

    When truncation is needed, keeps the head (imports/header) and the tail
    (final functions/close) so an AI sees context on both ends for roughly the
    same token cost. Returns ``(excerpt, truncated)``.
    """
    if max_chars <= 0 or len(source) <= max_chars:
        return source, False
    head_len = max_chars // 2
    tail_len = max_chars - head_len

    # Pick a bridge comment that won't break the language's syntax highlighter.
    lang_lower = language.lower()
    if lang_lower in ("html", "xml", "vue", ".html", ".xml", ".vue", ".jsx", ".tsx"):
        bridge = "\n\n<!-- ... truncated middle ... -->\n\n"
    elif lang_lower in ("markdown", "md", ".md", ".markdown"):
        bridge = "\n\n... truncated middle ...\n\n"
    elif lang_lower in ("yaml", "yml", "toml", ".yaml", ".yml", ".toml"):
        bridge = "\n\n# ... truncated middle ...\n\n"
    else:
        bridge = "\n\n/* ... truncated middle ... */\n\n"

    return source[:head_len] + bridge + source[-tail_len:], True


class UltimateCodeAnalyzer:
    """Language-specific lightweight analyzers. Results are deliberately JSON-like."""

    @staticmethod
    def analyze_file(file_path: Path) -> Dict[str, Any]:
        languages = LanguageDetector.detect_by_extension(file_path)
        if not languages:
            languages = LanguageDetector.detect_by_filename(file_path)
        if not languages:
            languages = LanguageDetector.detect_by_shebang(file_path)
        if not languages:
            languages = ["Unknown"]

        result: Dict[str, Any] = {
            "detected_languages": languages,
            "primary_language": languages[0],
            "file_type": "source",
            "analysis": {},
        }
        primary = languages[0]
        analyzers = {
            "Python": UltimateCodeAnalyzer.analyze_python,
            "JavaScript": UltimateCodeAnalyzer.analyze_javascript,
            "TypeScript": UltimateCodeAnalyzer.analyze_javascript,
            "React": UltimateCodeAnalyzer.analyze_javascript,
            "Vue": UltimateCodeAnalyzer.analyze_javascript,
            "Angular": UltimateCodeAnalyzer.analyze_javascript,
            "PHP": UltimateCodeAnalyzer.analyze_php,
            "Rust": UltimateCodeAnalyzer.analyze_rust,
            "Solidity": UltimateCodeAnalyzer.analyze_solidity,
            "Go": UltimateCodeAnalyzer.analyze_go,
            "Java": UltimateCodeAnalyzer.analyze_java,
            "C": UltimateCodeAnalyzer.analyze_cpp,
            "C++": UltimateCodeAnalyzer.analyze_cpp,
            "Ruby": UltimateCodeAnalyzer.analyze_ruby,
            "Swift": UltimateCodeAnalyzer.analyze_swift,
            "Kotlin": UltimateCodeAnalyzer.analyze_kotlin,
            "Shell": UltimateCodeAnalyzer.analyze_shell,
            "PowerShell": UltimateCodeAnalyzer.analyze_shell,
            "SQL": UltimateCodeAnalyzer.analyze_sql,
            "HTML": UltimateCodeAnalyzer.analyze_markup,
            "CSS": UltimateCodeAnalyzer.analyze_markup,
            "Docker": UltimateCodeAnalyzer.analyze_devops,
            "Kubernetes": UltimateCodeAnalyzer.analyze_devops,
            "Ansible": UltimateCodeAnalyzer.analyze_devops,
            "Markdown": UltimateCodeAnalyzer.analyze_data_format,
            "JSON": UltimateCodeAnalyzer.analyze_data_format,
            "YAML": UltimateCodeAnalyzer.analyze_data_format,
            "TOML": UltimateCodeAnalyzer.analyze_data_format,
            "XML": UltimateCodeAnalyzer.analyze_data_format,
        }
        analyzer = analyzers.get(primary)
        if analyzer:
            result["analysis"] = analyzer(file_path)
        else:
            result["analysis"] = {"message": f"No specialized analyzer for {primary}"}

        lowered = str(file_path).lower()
        if "test" in lowered or "spec" in lowered:
            result["file_type"] = "test"
        elif file_path.name.lower() in {"package.json", "composer.json", "manifest.json", "pyproject.toml", "cargo.toml", "dockerfile"}:
            result["file_type"] = "configuration"
        elif file_path.suffix.lower() in {".md", ".markdown", ".txt"}:
            result["file_type"] = "documentation"
        return result

    @staticmethod
    def analyze_python(file_path: Path) -> Dict[str, Any]:
        result: Dict[str, Any] = {"imports": [], "functions": [], "classes": [], "variables": []}
        content = read_text(file_path)
        try:
            tree = ast.parse(content, filename=str(file_path))
            for node in ast.walk(tree):
                if isinstance(node, (ast.Import, ast.ImportFrom)):
                    if isinstance(node, ast.Import):
                        result["imports"].extend(alias.name for alias in node.names)
                    else:
                        result["imports"].append((node.module or ".") + (".*" if any(a.name == "*" for a in node.names) else ""))
                elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    result["functions"].append({
                        "name": node.name,
                        "params": parameter_names(node.args),
                        "async": isinstance(node, ast.AsyncFunctionDef),
                        "line": node.lineno,
                        "doc": first_doc_line(node),
                    })
                elif isinstance(node, ast.ClassDef):
                    methods = [
                        {
                            "name": child.name,
                            "params": parameter_names(child.args),
                            "async": isinstance(child, ast.AsyncFunctionDef),
                            "line": child.lineno,
                        }
                        for child in node.body
                        if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef))
                    ]
                    bases = []
                    if hasattr(ast, "unparse"):
                        for base in node.bases:
                            try:
                                bases.append(ast.unparse(base))
                            except (TypeError, ValueError):
                                bases.append(getattr(base, "id", str(base)))
                    else:
                        bases = [getattr(base, "id", str(base)) for base in node.bases]
                    result["classes"].append({
                        "name": node.name, "bases": bases, "methods": methods, "line": node.lineno, "doc": first_doc_line(node),
                    })
            result["imports"] = unique_strings(result["imports"])
        except SyntaxError as exc:
            result["error"] = f"Python syntax error at line {exc.lineno}: {exc.msg}"
            result["functions"] = [
                {"name": name, "params": [p.strip() for p in params.split(",") if p.strip()], "line": line_number(content, match.start())}
                for match in re.finditer(r"(?:async\s+)?def\s+(\w+)\s*\(([^)]*)\)", content)
                for name, params in [(match.group(1), match.group(2))]
            ]
        return result

    @staticmethod
    def analyze_javascript(file_path: Path) -> Dict[str, Any]:
        content = read_text(file_path)
        functions: List[Dict[str, Any]] = []
        classes: List[Dict[str, Any]] = []
        imports = re.findall(r"\bimport\s+(?:[^;]*?\s+from\s+)?[\"']([^\"']+)[\"']", content)
        imports += re.findall(r"\brequire\s*\(\s*[\"']([^\"']+)[\"']\s*\)", content)

        function_pattern = re.compile(
            r"\b(?:async\s+)?function\s*([A-Za-z_$][\w$]*)?\s*\(([^)]*)\)|\b(?:async\s+)?([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*=>"
        )
        seen_functions = set()
        for match in function_pattern.finditer(content):
            name = match.group(1) or match.group(3) or "anonymous"
            params = match.group(2) if match.group(1) else match.group(4)
            key = (name, line_number(content, match.start()))
            if key not in seen_functions:
                seen_functions.add(key)
                functions.append({"name": name, "params": [p.strip() for p in (params or "").split(",") if p.strip()], "line": key[1]})

        # Named exports: export { fn, Cls, ... }
        named_exports = re.findall(r"\bexport\s*\{([^}]+)\}", content)
        extra_exports: List[str] = []
        for group in named_exports:
            extra_exports.extend(token.strip() for token in group.split(",") if token.strip())

        for match in re.finditer(r"\bclass\s+([A-Za-z_$][\w$]*)(?:\s+extends\s+([A-Za-z_$][\w$]*))?", content):
            cls_name = match.group(1)
            cls_extends = match.group(2)
            body_start = match.end()
            # Find matching brace to extract methods
            brace_depth = 0
            scan = body_start
            for i, ch in enumerate(content[body_start:], start=body_start):
                if ch == "{":
                    brace_depth += 1
                elif ch == "}":
                    brace_depth -= 1
                    if brace_depth == 0:
                        scan = i
                        break
            body = content[body_start:scan + 1]
            methods = re.findall(
                r"\b(?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{", body
            )

            # Capture JSDoc comment immediately above the class
            jsdoc = None
            preamble = content[:match.start()].rstrip()
            jsdoc_match = re.search(r"/\*\*(.+?)\*/\s*$", preamble, re.DOTALL)
            if jsdoc_match:
                jsdoc = re.sub(r"\*|\/|/", "", jsdoc_match.group(1)).strip()[:160]

            classes.append({
                "name": cls_name, "extends": cls_extends,
                "methods": [{"name": m} for m in methods[:10]],
                "line": line_number(content, match.start()),
                "doc": jsdoc,
            })
        return {
            "imports": unique_strings(imports), "functions": functions,
            "classes": classes,
            "exports": unique_strings(
                re.findall(r"\bexport\s+(?:default\s+)?(?:class|function|const|let|var)\s+([\w$]+)", content)
                + extra_exports
            ),
        }

    @staticmethod
    def analyze_php(file_path: Path) -> Dict[str, Any]:
        content = read_text(file_path)
        result: Dict[str, Any] = {"namespace": None, "uses": [], "imports": [], "functions": [], "classes": [], "routes": []}
        namespace = re.search(r"\bnamespace\s+([^;{]+)", content)
        result["namespace"] = namespace.group(1).strip() if namespace else None
        result["uses"] = unique_strings(re.findall(r"\buse\s+([^;]+);", content))
        include_names = r"(?:require|require_once|include|include_once)"
        result["imports"] = unique_strings(
            re.findall(r"\b" + include_names + r"\s*\(\s*'([^']+)'", content)
            + re.findall(r'\b' + include_names + r'\s*\(\s*"([^"]+)"', content)
        )

        class_pattern = re.compile(
            r"\b(class|interface|trait|enum)\s+([A-Za-z_]\w*)(?:\s+extends\s+([^\s{]+))?(?:\s+implements\s+([^\{]+))?\s*\{"
        )
        for match in class_pattern.finditer(content):
            body_start = match.end()
            class_end_match = re.search(r"^}\s*$", content[body_start:], re.MULTILINE)
            body_end = body_start + class_end_match.start() if class_end_match else len(content)
            body = content[body_start:body_end]
            methods = []
            for method in re.finditer(r"\b(?:(?:public|protected|private|static|final|abstract)\s+)*function\s*&?\s*([A-Za-z_]\w*)\s*\(([^)]*)\)", body):
                methods.append({"name": method.group(1), "params": [p.strip() for p in method.group(2).split(",") if p.strip()]})
            result["classes"].append({
                "kind": match.group(1),
                "name": match.group(2),
                "extends": match.group(3),
                "implements": [x.strip() for x in (match.group(4) or "").split(",") if x.strip()],
                "methods": methods,
                "line": line_number(content, match.start()),
            })

        for match in re.finditer(r"\bfunction\s*&?\s*([A-Za-z_]\w*)\s*\(([^)]*)\)", content):
            item = {"name": match.group(1), "params": [p.strip() for p in match.group(2).split(",") if p.strip()], "line": line_number(content, match.start())}
            if not any(item["name"] == method.get("name") and item["line"] == method.get("line") for method in result["functions"]):
                result["functions"].append(item)

        route_pattern = re.compile(r"\b(?:ApiRouter|Router|Route)\s*(?:::|->)\s*(get|post|put|patch|delete|options|any)\s*\(\s*['\"]([^'\"]+)", re.IGNORECASE)
        result["routes"] = [
            {"method": match.group(1).upper(), "path": match.group(2), "line": line_number(content, match.start())}
            for match in route_pattern.finditer(content)
        ]
        return result

    @staticmethod
    def analyze_rust(file_path: Path) -> Dict[str, Any]:
        content = read_text(file_path)
        return {
            "imports": unique_strings(re.findall(r"\buse\s+([^;]+);", content)),
            "functions": [{"name": m.group(1), "params": [p.strip() for p in m.group(2).split(",") if p.strip()], "line": line_number(content, m.start())} for m in re.finditer(r"\bfn\s+(\w+)\s*\(([^)]*)\)", content)],
            "classes": [],
            "structs": [{"name": m.group(1), "line": line_number(content, m.start())} for m in re.finditer(r"\bstruct\s+(\w+)", content)],
            "enums": [{"name": m.group(1), "line": line_number(content, m.start())} for m in re.finditer(r"\benum\s+(\w+)", content)],
        }

    @staticmethod
    def analyze_solidity(file_path: Path) -> Dict[str, Any]:
        content = read_text(file_path)
        return {
            "imports": unique_strings(re.findall(r"\bimport\s+[\"']([^\"']+)[\"']", content)),
            "functions": [{"name": m.group(1), "params": [p.strip() for p in m.group(2).split(",") if p.strip()], "line": line_number(content, m.start())} for m in re.finditer(r"\bfunction\s+(\w+)\s*\(([^)]*)\)", content)],
            "classes": [{"name": m.group(2), "kind": m.group(1), "methods": []} for m in re.finditer(r"\b(contract|interface|library)\s+(\w+)", content)],
        }

    @staticmethod
    def analyze_go(file_path: Path) -> Dict[str, Any]:
        content = read_text(file_path)
        flat_imports = re.findall(r"\bimport\s+[\"']([^\"']+)[\"']", content)
        for block in re.findall(r"\bimport\s*\((.*?)\)", content, re.DOTALL):
            flat_imports.extend(re.findall(r"[\"']([^\"']+)[\"']", block))
        return {
            "imports": unique_strings(flat_imports),
            "functions": [{"name": m.group(1), "params": [p.strip() for p in m.group(2).split(",") if p.strip()], "line": line_number(content, m.start())} for m in re.finditer(r"\bfunc\s+(\w+)\s*\(([^)]*)\)", content)],
            "structs": [{"name": m.group(1), "line": line_number(content, m.start())} for m in re.finditer(r"\btype\s+(\w+)\s+struct", content)],
            "interfaces": [{"name": m.group(1), "line": line_number(content, m.start())} for m in re.finditer(r"\btype\s+(\w+)\s+interface", content)],
        }

    @staticmethod
    def analyze_java(file_path: Path) -> Dict[str, Any]:
        content = read_text(file_path)
        return {
            "imports": unique_strings(re.findall(r"\bimport\s+([^;]+);", content)),
            "classes": [{"name": m.group(2), "kind": m.group(1), "extends": m.group(3), "implements": [x.strip() for x in (m.group(4) or "").split(",") if x.strip()], "methods": []} for m in re.finditer(r"\b(class|interface|enum)\s+(\w+)(?:\s+extends\s+(\w+))?(?:\s+implements\s+([^\{]+))?", content)],
            "functions": [{"name": m.group(2), "params": [p.strip() for p in m.group(3).split(",") if p.strip()]} for m in re.finditer(r"\b(\w[\w<>\[\]]*)\s+(\w+)\s*\(([^)]*)\)", content)],
        }

    @staticmethod
    def analyze_cpp(file_path: Path) -> Dict[str, Any]:
        content = read_text(file_path)
        return {
            "includes": unique_strings(re.findall(r"#include\s*[<\"]([^>\"]+)[>\"]", content)),
            "functions": [{"name": m.group(1), "params": [p.strip() for p in m.group(2).split(",") if p.strip()], "line": line_number(content, m.start())} for m in re.finditer(r"\b(\w+)\s*\(([^)]*)\)\s*\{", content)],
            "classes": [{"name": m.group(1), "methods": []} for m in re.finditer(r"\bclass\s+(\w+)", content)],
            "structs": [{"name": m.group(1)} for m in re.finditer(r"\bstruct\s+(\w+)", content)],
        }

    @staticmethod
    def analyze_ruby(file_path: Path) -> Dict[str, Any]:
        content = read_text(file_path)
        return {"requires": unique_strings(re.findall(r"\brequire\s+['\"]([^'\"]+)", content)), "classes": [{"name": m.group(1), "inherits": m.group(2) or None} for m in re.finditer(r"\bclass\s+(\w+)\s*(?:<\s*([^\s]+))?", content)], "modules": [{"name": m.group(1)} for m in re.finditer(r"\bmodule\s+(\w+)", content)], "functions": [{"name": m.group(1), "params": [p.strip() for p in m.group(2).split(",") if p.strip()]} for m in re.finditer(r"\bdef\s+(\w+)(?:\(([^)]*)\))?", content)]}

    @staticmethod
    def analyze_swift(file_path: Path) -> Dict[str, Any]:
        content = read_text(file_path)
        return {"imports": unique_strings(re.findall(r"\bimport\s+(\w+)", content)), "classes": [{"name": m.group(1), "inherits": [x.strip() for x in (m.group(2) or "").split(",") if x.strip()]} for m in re.finditer(r"\bclass\s+(\w+)\s*(?::\s*([^\{]+))?\s*\{", content)], "structs": [{"name": m.group(1)} for m in re.finditer(r"\bstruct\s+(\w+)", content)], "enums": [{"name": m.group(1)} for m in re.finditer(r"\benum\s+(\w+)", content)], "protocols": [{"name": m.group(1)} for m in re.finditer(r"\bprotocol\s+(\w+)", content)]}

    @staticmethod
    def analyze_kotlin(file_path: Path) -> Dict[str, Any]:
        content = read_text(file_path)
        return {"imports": unique_strings(re.findall(r"\bimport\s+([^\n]+)", content)), "classes": [{"name": m.group(1), "extends": m.group(2) or None} for m in re.finditer(r"\b(?:data\s+)?class\s+(\w+)(?:\([^)]*\))?(?:\s*:\s*([^\{]+))?", content)], "functions": [{"name": m.group(1), "params": [p.strip() for p in m.group(2).split(",") if p.strip()]} for m in re.finditer(r"\bfun\s+(\w+)\s*\(([^)]*)\)", content)]}

    @staticmethod
    def analyze_shell(file_path: Path) -> Dict[str, Any]:
        content = read_text(file_path)
        variables = [
            {"name": m.group(1), "value": m.group(2).strip()[:80]}
            for m in re.finditer(r"^\s*(\w+)\s*=\s*['\"]?([^'\"\n]+)", content, re.MULTILINE)
            if not m.group(2).strip().startswith("function ")
        ]
        # Supports both `name() { ... }` and `function name { ... }`; keeps
        # the first line of the body as a hint of what the function does.
        functions = [
            {"name": m.group(1), "body": m.group(2).strip()[:100]}
            for m in re.finditer(r"(?:function\s+)?([A-Za-z_][\w-]*)\s*\(\)\s*\{([^\n]*)" , content)
        ]
        functions += [
            {"name": m.group(1), "body": m.group(2).strip()[:100]}
            for m in re.finditer(r"\bfunction\s+([A-Za-z_][\w-]*)\s*\{(.*?)\n\}", content, re.DOTALL)
        ]
        return {"commands": [], "variables": variables, "functions": functions}

    @staticmethod
    def analyze_sql(file_path: Path) -> Dict[str, Any]:
        content = read_text(file_path).upper()
        return {"tables": unique_strings(re.findall(r"\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([\w.]+)", content)), "views": unique_strings(re.findall(r"\bCREATE\s+VIEW\s+([\w.]+)", content)), "procedures": unique_strings(re.findall(r"\bCREATE\s+PROCEDURE\s+([\w.]+)", content)), "functions": unique_strings(re.findall(r"\bCREATE\s+FUNCTION\s+([\w.]+)", content))}

    @staticmethod
    def analyze_markup(file_path: Path) -> Dict[str, Any]:
        content = read_text(file_path)
        is_css = file_path.suffix.lower() in {".css", ".scss", ".sass", ".less"}
        tags = unique_strings(re.findall(r"<([A-Za-z][\w:-]*)\b", content)) if not is_css else []
        html_classes = re.findall(r"\bclass\s*=\s*['\"]([^'\"]+)['\"]", content)
        class_tokens = [token for group in html_classes for token in re.findall(r"[\w-]+", group)]
        css_classes = re.findall(r"\.([A-Za-z_-][\w-]*)", content) if is_css else []
        ids = re.findall(r"\bid\s*=\s*['\"]([^'\"]+)['\"]", content) if not is_css else re.findall(r"#([A-Za-z_-][\w-]*)", content)
        return {"tags": tags[:40], "markup_classes": unique_strings(class_tokens + css_classes)[:80], "ids": unique_strings(ids)[:80], "selectors": unique_strings(re.findall(r"[^{}]+(?=\{)", content))[:30]}

    @staticmethod
    def analyze_devops(file_path: Path) -> Dict[str, Any]:
        content = read_text(file_path)
        return {"resources": unique_strings(re.findall(r"^\s*kind:\s*([\w-]+)", content, re.MULTILINE | re.IGNORECASE)), "commands": re.findall(r"^\s*RUN\s+(.+)$", content, re.MULTILINE), "labels": re.findall(r"^\s*LABEL\s+(.+)$", content, re.MULTILINE)}

    @staticmethod
    def analyze_data_format(file_path: Path) -> Dict[str, Any]:
        content = read_text(file_path)
        result: Dict[str, Any] = {"keys": [], "structure": "simple"}
        if file_path.suffix.lower() == ".json":
            try:
                data = json.loads(content)
                if isinstance(data, dict):
                    result["keys"] = list(data.keys())[:100]
                    result["structure"] = "complex" if len(data) > 10 else "simple"
            except (ValueError, TypeError):
                result["error"] = "Invalid JSON"
        else:
            result["keys"] = unique_strings(re.findall(r"^\s*([\w.-]+)\s*:", content, re.MULTILINE))[:100]
        return result


class UltimateProjectDocumentationGenerator:
    """Scan a project and create a searchable Markdown context document."""

    DEFAULT_IGNORED_DIRS = {
        "node_modules", "__pycache__", ".git", ".vscode", ".idea", "venv", "env", ".venv",
        "dist", "build", "target", "coverage", ".pytest_cache", ".mypy_cache", ".tox", "vendor",
        "bower_components", "jspm_packages", ".cache", "cache", "logs", "tmp", "temp", "uploads",
    }
    BINARY_EXTENSIONS = {
        ".7z", ".avi", ".bmp", ".class", ".dll", ".doc", ".docx", ".eot", ".exe", ".gif", ".ico", ".jar",
        ".jpeg", ".jpg", ".mp3", ".mp4", ".mov", ".otf", ".pdf", ".pfb", ".pfm", ".png", ".rar", ".so", ".tar", ".ttf", ".wav",
        ".webm", ".woff", ".woff2", ".xls", ".xlsx", ".zip",
    }
    CSS_EXTENSIONS = {".css", ".scss", ".sass", ".less"}
    FONT_EXTENSIONS = {".eot", ".fnt", ".otf", ".pfb", ".pfm", ".ttf", ".woff", ".woff2"}
    SOURCE_EXTENSIONS = {
        ".c", ".cc", ".cpp", ".cs", ".css", ".dart", ".go", ".h", ".hpp", ".html", ".java", ".js", ".jsx",
        ".json", ".kt", ".kts", ".less", ".m", ".md", ".php", ".phtml", ".ps1", ".py", ".rb", ".rs",
        ".sass", ".scala", ".scss", ".sh", ".sol", ".sql", ".swift", ".toml", ".ts", ".tsx", ".vue", ".xml", ".yaml", ".yml",
    }
    SOURCE_FILENAMES = {"dockerfile", "makefile", "cmakelists.txt", "rakefile", "gemfile", "procfile", ".env.example"}

    def __init__(self, project_path: str, output_path: Optional[str] = None, include_source: bool = True, max_source_chars: int = 2500, max_file_size_kb: int = 1024, extra_ignored_dirs: Optional[Sequence[str]] = None, max_tree_depth: int = 4, exclude_css: bool = True, exclude_fonts: bool = True, extra_ignored_paths: Optional[Sequence[str]] = None, verbose: bool = False, signatures: bool = False, follow_symlinks: bool = False, progress_callback: Optional[Callable[[int, int], None]] = None, cancel_check: Optional[Callable[[], bool]] = None, detail_level: Optional[str] = None, max_source_kb: Optional[int] = None, max_symbols: Optional[int] = None):
        self.project_path = Path(project_path).expanduser().resolve()
        self.project_name = self.project_path.name or str(self.project_path)
        default_output = self.project_path / "AGENTS.md"
        requested_output = Path(output_path).expanduser() if output_path else default_output
        self.output_path = (Path.cwd() / requested_output).resolve() if not requested_output.is_absolute() else requested_output.resolve()
        self.include_source = include_source
        self.max_source_chars = max(0, max_source_chars)
        self.max_file_size = max(0, max_file_size_kb) * 1024 if max_file_size_kb > 0 else None
        self.max_tree_depth = max(0, max_tree_depth)
        self.exclude_css = exclude_css
        self.exclude_fonts = exclude_fonts
        self.verbose = verbose
        self.signatures = signatures
        self.follow_symlinks = follow_symlinks
        self.progress_callback = progress_callback
        self.cancel_check = cancel_check
        self.ignored_dirs = self.DEFAULT_IGNORED_DIRS | {item.lower() for item in (extra_ignored_dirs or [])}

        # -- Token-economy controls (detail tier + budgets) -----------------
        self.detail_level = detail_level
        self.max_source_kb = max_source_kb  # global per-run budget in KB; None = uncapped
        self.max_symbols = max_symbols
        self._source_budget_remaining = None  # filled after scan when budgeted
        self.render_full_details = True
        self.ignored_paths = {
            normalized
            for item in (extra_ignored_paths or [])
            if (normalized := self._normalize_exclude_path(item))
        }
        self.analysis: Dict[str, Any] = {
            "structure": {}, "languages_detected": set(), "frameworks_detected": {}, "language_stats": {},
            "file_count": 0, "total_size": 0, "total_functions": 0, "total_classes": 0,
            "skipped_files": [], "scan_errors": [], "timestamp": dt.datetime.now().isoformat(timespec="seconds"),
        }

    def _normalize_exclude_path(self, value: str) -> Optional[str]:
        """Normalize an explicit folder path relative to the project root."""
        candidate = Path(value).expanduser()
        if candidate.is_absolute():
            try:
                candidate = candidate.resolve().relative_to(self.project_path)
            except ValueError:
                return None
        normalized = candidate.as_posix().replace("\\", "/").strip("/").strip()
        if not normalized or normalized == ".":
            return None
        return normalized.casefold()

    def _is_excluded_path(self, path: Path) -> bool:
        normalized = path.as_posix().replace("\\", "/").strip("/").casefold()
        return any(
            normalized == ignored or normalized.startswith(ignored + "/")
            for ignored in self.ignored_paths
        )

    # ------------------------------------------------------------------ tiers
    def _resolve_tier(self) -> None:
        """Pick the effective detail tier from an explicit choice or file count.

        The tier sets a global source-KB budget, a symbol-index cap, and whether
        per-file ``File Details`` blocks get full symbol listings. Explicit CLI
        flags always win over the auto-picked values.
        """
        count = self.analysis["file_count"]
        auto = "full" if count <= 50 else "standard" if count <= 200 else "minimal"
        chosen = (self.detail_level or auto).lower()
        if chosen not in DETAIL_TIERS:
            chosen = auto

        budget_default, symbol_cap_default, full_details = DETAIL_TIERS[chosen]
        if self.max_source_kb is None:
            self.max_source_kb = budget_default
        if self.max_symbols is None:
            self.max_symbols = symbol_cap_default
        self.render_full_details = full_details
        self.detail_level = chosen

    def _is_generated_source(self, file_path: Path) -> bool:
        """True for files whose body should never be embedded as source."""
        name = file_path.name.lower()
        if name in LOCK_FILES:
            return True
        if name.endswith(".min.js") or name.endswith(".min.css"):
            return True
        rel = file_path.as_posix().lower().replace("\\", "/")
        if "/vendor/" in rel:
            return True
        # Large data/config blobs add tokens without aiding understanding.
        if file_path.suffix.lower() in DATA_EXTENSIONS and file_path.stat().st_size > 50 * 1024:
            return True
        return False

    def _is_probably_text(self, path: Path) -> bool:
        if path.suffix.lower() in self.BINARY_EXTENSIONS:
            return False
        try:
            with path.open("rb") as handle:
                sample = handle.read(4096)
            return b"\x00" not in sample
        except OSError as exc:
            self.analysis["scan_errors"].append(f"{path}: {exc}")
            return False

    def _should_skip(self, path: Path) -> Optional[str]:
        if path.is_symlink() and not self.follow_symlinks:
            return "symbolic link"
        if path.resolve() == self.output_path:
            return "generated output"
        extension = path.suffix.lower()
        if self.exclude_css and extension in self.CSS_EXTENSIONS:
            return "CSS excluded by default profile"
        if self.exclude_fonts and extension in self.FONT_EXTENSIONS:
            return "font excluded by default profile"
        try:
            size = path.stat().st_size
        except OSError as exc:
            self.analysis["scan_errors"].append(f"{path}: {exc}")
            return "unreadable metadata"
        if self.max_file_size is not None and size > self.max_file_size:
            return f"larger than {self.max_file_size // 1024} KB"
        if not self._is_probably_text(path):
            return "binary or unreadable"
        if path.name.endswith(".min.js") or path.name.endswith(".min.css"):
            return "minified asset"
        return None

    def scan_project(self) -> None:
        print(f"[INFO] Scanning project: {self.project_path}")
        self._resolve_tier()
        if self.max_source_kb:
            self._source_budget_remaining = self.max_source_kb * 1024
        if self.detail_level != "full":
            print(f"[INFO] Detail level: {self.detail_level} "
                  f"(source budget {self.max_source_kb} KB, symbol cap {self.max_symbols}).")

        # Collect candidate files in a single walk, applying dir filters once.
        candidates: List[Tuple[str, str, Path]] = []
        for root, dirs, files in os.walk(self.project_path, followlinks=False):
            rel_path = Path(root).relative_to(self.project_path)
            kept_dirs = []
            for directory in dirs:
                candidate = rel_path / directory
                if directory.lower() in self.ignored_dirs:
                    continue
                if self._is_excluded_path(candidate):
                    self.analysis["skipped_files"].append({
                        "path": candidate.as_posix(),
                        "reason": "directory excluded by --exclude-path",
                    })
                    continue
                kept_dirs.append(directory)
            dirs[:] = kept_dirs
            directory_key = str(rel_path) if str(rel_path) != "." else "."
            for filename in sorted(files, key=str.casefold):
                candidates.append((directory_key, filename, Path(root) / filename))

        total_candidates = len(candidates)
        for processed, (directory_key, filename, file_path) in enumerate(candidates, 1):
            if self.cancel_check is not None and self.cancel_check():
                print("\n[INFO] Scan cancelled.")
                raise ScanCancelled("Scan cancelled by user.")
            # Render progress bar
            if total_candidates > 0:
                percent = int((processed / total_candidates) * 100)
                bar_len = 30
                filled_len = int(bar_len * processed // total_candidates)
                bar = "█" * filled_len + "-" * (bar_len - filled_len)
                sys.stdout.write(f"\r[INFO] Scanning [{bar}] {percent}% ({processed}/{total_candidates})")
                sys.stdout.flush()
                if self.progress_callback is not None:
                    self.progress_callback(processed, total_candidates)

            reason = self._should_skip(file_path)
            if reason:
                if self.verbose:
                    print(f"\n[VERBOSE] Skipped {file_path.relative_to(self.project_path)}: {reason}")
                self.analysis["skipped_files"].append({"path": str(file_path.relative_to(self.project_path)), "reason": reason})
                continue
            try:
                stat = file_path.stat()
                analyzed = UltimateCodeAnalyzer.analyze_file(file_path)
                content = read_text(file_path)
                rel_file_path = file_path.relative_to(self.project_path)
                if self.verbose:
                    print(f"\n[VERBOSE] Processed: {rel_file_path} ({analyzed.get('primary_language', 'Unknown')})")
                source = None
                file_ext = file_path.suffix.lower()
                if self.include_source and (file_ext in self.SOURCE_EXTENSIONS or filename.lower() in self.SOURCE_FILENAMES):
                    # Lock/generated/data files add huge token cost with no
                    # understanding value, so never embed their bodies.
                    if not self._is_generated_source(file_path):
                        # Respect a global source budget so total embedded size
                        # stays bounded on large projects.
                        if self._source_budget_remaining is None:
                            source, _ = bounded_excerpt(content, self.max_source_chars, file_ext)
                        elif self._source_budget_remaining > 0:
                            cap = min(self.max_source_chars, self._source_budget_remaining)
                            source, _ = bounded_excerpt(content, cap, file_ext)
                            self._source_budget_remaining -= len(source or "")
                        else:
                            source = None
                file_info = {
                    "name": filename, "path": str(rel_file_path), "size": stat.st_size, "lines": content.count("\n") + (1 if content else 0),
                    "extension": file_path.suffix.lower(), "language": analyzed.get("primary_language", "Unknown"),
                    "file_type": analyzed.get("file_type", "source"), "analysis": analyzed.get("analysis", {}),
                    "source": source,
                }
                self.analysis["structure"].setdefault(directory_key, {"files": []})["files"].append(file_info)
                self.analysis["file_count"] += 1
                self.analysis["total_size"] += stat.st_size
                self.analysis["languages_detected"].update(analyzed.get("detected_languages", []))
                symbols = file_info["analysis"]
                self.analysis["total_functions"] += function_count(symbols)
                self.analysis["total_classes"] += len(symbol_list(symbols.get("classes")))
                ext = file_path.suffix.lower() or "[no extension]"
                self.analysis["language_stats"][ext] = self.analysis["language_stats"].get(ext, 0) + 1
                if symbols.get("error"):
                    self.analysis["scan_errors"].append(f"{rel_file_path}: {symbols['error']}")
            except Exception as exc:
                self.analysis["scan_errors"].append(f"{file_path}: {type(exc).__name__}: {exc}")

        print() # Newline after progress bar
        self.analysis["frameworks_detected"] = LanguageDetector.detect_frameworks(self.project_path)

    def _all_files(self) -> List[Dict[str, Any]]:
        return [file_info for data in self.analysis["structure"].values() for file_info in data.get("files", [])]

    def _entry_points(self, files: Optional[List[Dict[str, Any]]] = None) -> List[str]:
        names = {"index.php", "index.html", "main.py", "app.py", "manage.py", "server.js", "main.js", "index.js", "package.json", "composer.json", "pyproject.toml", "dockerfile", "manifest.json"}
        app_names = {"app.php", "router.php", "api.php"}
        files = files if files is not None else self._all_files()
        return [
            item["path"] for item in files
            if item["name"].lower() in names
            or (
                item["path"].lower().startswith(("app/", "src/"))
                and item["name"].lower() in app_names
            )
        ]

    def _global_symbol_index(self, files: Optional[List[Dict[str, Any]]] = None) -> List[str]:
        """A compact symbol -> file table so an AI can jump to the right file fast.

        Enabled/expanded by the ``--signatures`` flag. Without it the index lists
        only the most public symbols (classes, imports, functions) as short rows.
        """
        lines: List[str] = ["", "## Global Symbol Index", "", "_Use this to locate definitions quickly, then jump to the File Details section._", ""]
        rows: List[Tuple[str, str, str, str]] = []  # (symbol, kind, file, signature)

        for item in (files if files is not None else self._all_files()):
            analysis = item.get("analysis") or {}
            path = item.get("path", "")
            base = item.get("name", "")
            # In compact/minimal tiers, drop private/internal symbols (leading
            # underscore or namespaced \Internal\/private\) to shrink the index.
            if self.render_full_details:
                pub = lambda n: True  # type: ignore[assignment]
            else:
                pub = self._is_public_symbol
            for cls in symbol_list(analysis.get("classes")):
                if isinstance(cls, dict):
                    name = symbol_name(cls)
                    if not pub(name):
                        continue
                    sig = ""
                    if self.signatures:
                        sig = format_symbol(cls)
                    rows.append((name, "class", path, sig))
                    for method in symbol_list(cls.get("methods")):
                        mname = symbol_name(method)
                        if not pub(mname):
                            continue
                        msig = ""
                        if self.signatures:
                            msig = format_symbol(method)
                        rows.append((f"{name}.{mname}", "method", path, msig))
            for func in symbol_list(analysis.get("functions")):
                if isinstance(func, dict):
                    fname = symbol_name(func)
                    if not pub(fname):
                        continue
                    sig = ""
                    if self.signatures:
                        sig = format_symbol(func)
                    rows.append((fname, "function", path, sig))
            for imp in symbol_list(analysis.get("imports")):
                rows.append((str(imp), "import", path, ""))
            for ext_name in symbol_list(analysis.get("exports")) or []:
                rows.append((str(ext_name), "export", path, ""))

        # Deduplicate by (symbol, kind, file) so repeated imports collapse to one row.
        seen = set()
        deduped: List[Tuple[str, str, str, str]] = []
        for row in rows:
            key = (row[0], row[1], row[2])
            if key in seen:
                continue
            seen.add(key)
            deduped.append(row)

        if not deduped:
            return ["", "## Global Symbol Index", "", "_No public symbols detected._", ""]

        # Cap the index for token economy; a very large number of symbols can
        # explode the output. Classes are collected before functions/imports
        # above, so the head of the list already favors the most useful symbols.
        cap = self.max_symbols if self.max_symbols else len(deduped)
        if len(deduped) > cap:
            lines.append(f"> _Showing first {cap} of {len(deduped)} symbols. Increase with --max-symbols._")
        sig_header = " Signature " if self.signatures else ""
        lines.extend(["", f"| Symbol | Kind | File |{sig_header}", "|---|---|---|---|"])
        for sym, kind, path, sig in deduped[:cap]:
            if self.signatures:
                lines.append(f"| `{escape_table(sym)}` | {escape_table(kind)} | [`{escape_table(path)}`](#{anchor(path)}) | {escape_table(sig)} |")
            else:
                lines.append(f"| `{escape_table(sym)}` | {escape_table(kind)} | [`{escape_table(path)}`](#{anchor(path)}) |")
        return lines + [""]

    def _global_dependencies(self, files: List[Dict[str, Any]]) -> Dict[str, List[str]]:
        """Aggregate every import/require/use, grouped by ecosystem/language.

        Grouping keeps related deps together and reads more naturally than a
        flat de-duplicated list; each group is still sorted and unique.
        """
        grouped: Dict[str, set] = defaultdict(set)
        for item in files:
            lang = str(item.get("language", "") or "Other").strip() or "Other"
            analysis = item.get("analysis") or {}
            for key in ("imports", "uses", "requires", "includes"):
                for value in symbol_list(analysis.get(key)):
                    name = symbol_name(value)
                    if name:
                        grouped[lang].add(name)
        return {lang: sorted(deps, key=str.casefold) for lang, deps in grouped.items()}

    def _file_inventory_compact(self, files: List[Dict[str, Any]]) -> List[str]:
        """Per-directory aggregate stats instead of one row per file.

        Used in compact/minimal tiers; the full per-file table is emitted only
        in the full tier.
        """
        stats: Dict[str, Dict[str, Any]] = {}
        for item in files:
            path = Path(item.get("path", ""))
            top = path.parts[0] if path.parts else "."
            bucket = stats.setdefault(top, {"count": 0, "size": 0, "langs": set()})
            bucket["count"] += 1
            bucket["size"] += item.get("size", 0)
            bucket["langs"].add(item.get("language", "Unknown"))
        lines = ["_Aggregated per directory (use the full tier for a per-file table)._", ""]
        for name in sorted(stats):
            s = stats[name]
            langs = ", ".join(sorted(s["langs"], key=str.casefold))
            lines.append(f"- **`{escape_inline(name)}/`**: {s['count']} files, {s['size'] / 1024:.1f} KB — {langs}")
        return lines + [""]

    @staticmethod
    def _is_public_symbol(name: str) -> bool:
        """Symbols an AI should care about; drops private/internal noise."""
        if not name:
            return False
        if name.startswith("_"):
            return False
        if "\\Internal\\" in name or "\\private\\" in name:
            return False
        return True

    def _is_important_file(self, item: Dict[str, Any]) -> bool:
        """Files that earn a full File Details block in compact/minimal tiers."""
        if item.get("source") is not None:
            return True
        path = str(item.get("path", "")).lower().replace("\\", "/")
        if any(path.endswith(p) for p in ("index.php", "main.py", "app.py", "router.php", "index.html", "main.js", "index.js", "server.js", "manage.py", "app.js")):
            return True
        if any(seg in path for seg in ("/core/", "/src/core/", "/api/", "/controllers/", "/models/")):
            return True
        symbols = item.get("analysis") or {}
        return bool(symbol_list(symbols.get("classes"))) or function_count(symbols) > 0

    def _directory_tree(self) -> List[str]:
        lines = [f"{self.project_name}/"]
        structure = self.analysis["structure"]
        for directory in sorted(structure):
            if directory == ".":
                files = structure[directory].get("files", [])
                prefix = "  "
            else:
                depth = len(Path(directory).parts)
                if depth > self.max_tree_depth:
                    continue
                prefix = "  " * depth
                lines.append(f"{prefix}{Path(directory).name}/")
                files = structure[directory].get("files", [])
            for file_info in files:
                lines.append(f"{prefix}  {file_info['name']}")
        return lines

    def generate_report(self) -> str:
        files = sorted(self._all_files(), key=lambda item: item["path"].casefold())
        languages = sorted(self.analysis["languages_detected"])
        md: List[str] = [
            f"# Project Context: {self.project_name}",
            "",
            f"> Generated by `generate-docs.py` on {self.analysis['timestamp']}. This file is an index plus bounded source context for AI-assisted code understanding.",
            "",
            "## Quick Overview",
            "",
            f"- **Project root:** `{escape_inline(str(self.project_path))}`",
            f"- **Files indexed:** {self.analysis['file_count']}",
            f"- **Total size:** {self.analysis['total_size'] / (1024 * 1024):.2f} MB",
            f"- **Functions/methods:** {self.analysis['total_functions']}",
            f"- **Classes/interfaces/traits:** {self.analysis['total_classes']}",
            f"- **Skipped files:** {len(self.analysis['skipped_files'])}",
            f"- **Analysis warnings:** {len(self.analysis['scan_errors'])}",
            "",
            "### Languages",
            "",
            ", ".join(f"**{escape_inline(lang)}**" for lang in languages) if languages else "_None detected._",
            "",
            "### Frameworks and technologies",
            "",
        ]
        if self.analysis["frameworks_detected"]:
            for ecosystem, frameworks in sorted(self.analysis["frameworks_detected"].items()):
                md.append(f"- **{escape_inline(ecosystem)}:** {', '.join(escape_inline(item) for item in frameworks)}")
        else:
            md.append("_No known frameworks detected._")

        md.extend(["", "### Likely entry points and configuration", ""])
        entries = self._entry_points(files)
        md.extend(f"- [`{escape_inline(entry)}`](#{anchor(entry)})" for entry in entries[:80])
        if not entries:
            md.append("_No conventional entry point names detected._")

        md.extend(["", "## Directory Tree", "", "```text", *self._directory_tree(), "```", "", "## File Inventory", ""])
        if self.render_full_details:
            md.extend(["", "| Path | Language | Type | Size | Lines | Functions | Classes |", "|---|---|---|---:|---:|---:|---:|"])
            for item in files:
                symbols = item.get("analysis", {})
                md.append(f"| [`{escape_table(item['path'])}`](#{anchor(item['path'])}) | {escape_table(item.get('language', 'Unknown'))} | {escape_table(item.get('file_type', 'source'))} | {item['size'] / 1024:.1f} KB | {item.get('lines', 0)} | {function_count(symbols)} | {len(symbol_list(symbols.get('classes')))} |")
        else:
            # Compact: aggregate the per-file table into per-directory stats so a
            # large project isn't dominated by one row per file.
            md.extend(self._file_inventory_compact(files))

        md.extend(self._global_symbol_index(files))

        deps = self._global_dependencies(files)
        if deps:
            md.extend(["", "## External Dependencies", ""])
            for lang in sorted(deps):
                md.append(f"### {escape_inline(lang)}")
                md.extend(f"- `{escape_inline(dep)}`" for dep in deps[lang])
            md.append("")

        if self.analysis["skipped_files"]:
            md.extend(["", "## Skipped Files", "", "| Path | Reason |", "|---|---|"])
            for skipped in self.analysis["skipped_files"]:
                md.append(f"| `{escape_table(skipped['path'])}` | {escape_table(skipped['reason'])} |")
        if self.analysis["scan_errors"]:
            md.extend(["", "## Analysis Warnings", ""])
            md.extend(f"- {escape_inline(error)}" for error in self.analysis["scan_errors"][:100])

        md.extend(["", "## File Details", ""])
        if self.render_full_details:
            detail_files = files
        else:
            # Only expand important files inline; everything else stays in the
            # inventory/symbol index. This is the main token saver at scale.
            detail_files = [item for item in files if self._is_important_file(item)]
            if len(detail_files) < len(files):
                md.extend([
                    "",
                    f"_Showing full details for {len(detail_files)} of {len(files)} files "
                    f"(entry points, source-bearing, and core/api/model files). "
                    "Other files are listed in the inventory and symbol index above._",
                ])
        for item in detail_files:
            md.extend(self._render_file(item))
        return "\n".join(md).rstrip() + "\n"

    def _render_file(self, item: Dict[str, Any]) -> List[str]:
        analysis = item.get("analysis") or {}
        lines = [f"### `{escape_inline(item['path'])}` {{#{anchor(item['path'])}}}", "", f"- **Language:** {item.get('language', 'Unknown')}", f"- **Type:** {item.get('file_type', 'source')}", f"- **Size:** {item.get('size', 0) / 1024:.1f} KB; {item.get('lines', 0)} lines"]
        if analysis.get("namespace"):
            lines.append(f"- **Namespace:** `{escape_inline(str(analysis['namespace']))}`")

        has_source = item.get("source") is not None
        if self.render_full_details:
            # Full tier lists every symbol inline per file.
            for key, label in (("functions", "Functions"), ("classes", "Classes"), ("structs", "Structs"), ("interfaces", "Interfaces"), ("routes", "Routes"), ("imports", "Imports"), ("uses", "Uses"), ("requires", "Requires"), ("includes", "Includes"), ("markup_classes", "Markup classes"), ("selectors", "Selectors"), ("ids", "IDs"), ("tags", "Tags"), ("exports", "Exports"), ("resources", "Resources"), ("keys", "Top-level keys")):
                values = symbol_list(analysis.get(key))
                if not values:
                    continue
                lines.extend([f"", f"**{label} ({len(values)}):**"])
                for value in values[:30]:
                    if self.signatures:
                        lines.append(f"- {format_symbol(value)}")
                    else:
                        lines.append(f"- `{escape_inline(symbol_name(value))}`" + (f" — line {value['line']}" if isinstance(value, dict) and value.get("line") else ""))
                if len(values) > 30:
                    lines.append(f"- _... and {len(values) - 30} more_")
        else:
            # Compact tiers: the Global Symbol Index is canonical, so per-file
            # blocks only show a one-line count + file-specific items (routes,
            # errors). This removes the triple-redundancy of symbol names.
            symbols = analysis or {}
            n_func = function_count(symbols)
            n_cls = len(symbol_list(symbols.get("classes")))
            if n_func or n_cls:
                lines.append(
                    f"- **Symbols:** {n_func} functions/methods, {n_cls} classes — "
                    "see Global Symbol Index above."
                )
            routes = symbol_list(symbols.get("routes"))
            if routes:
                lines.extend(["", "**Routes:**"])
                for route in routes[:15]:
                    verb = escape_inline(str(route.get("method", "")))
                    path = escape_inline(str(route.get("path", "")))
                    lines.append(f"- `{verb} {path}`")

        if analysis.get("error"):
            lines.extend(["", f"> Analysis warning: {escape_inline(str(analysis['error']))}"])

        source = item.get("source")
        if source is not None:
            truncated = self.max_source_chars > 0 and len(source) >= self.max_source_chars
            if truncated:
                source += f"\n\n/* Source truncated at {self.max_source_chars:,} characters. Use the original file for the remainder. */"
            fence = fence_language(item.get("extension", ""), item.get("language", ""))
            marker = "```"
            while marker in source:
                marker += "`"
                if len(marker) > 10:  # Safety bound to avoid pathological infinite loops
                    break
            lines.extend(["", "<details>", "<summary>Source</summary>", "", f"{marker}{fence}", source.rstrip(), marker, "", "</details>"])
        return lines + ["", "---", ""]

    def generate_documentation(self) -> str:
        if not self.project_path.exists():
            raise FileNotFoundError(f"Project path does not exist: {self.project_path}")
        if not self.project_path.is_dir():
            raise NotADirectoryError(f"Project path is not a directory: {self.project_path}")
        print("[INFO] Starting analysis...")
        self.scan_project()
        print(f"[INFO] Files scanned: {self.analysis['file_count']}")
        print(f"[INFO] Languages detected: {len(self.analysis['languages_detected'])}")
        print(f"[INFO] Functions found: {self.analysis['total_functions']}")
        print(f"[INFO] Classes found: {self.analysis['total_classes']}")
        print("[INFO] Generating report...")
        report = self.generate_report()
        self.output_path.parent.mkdir(parents=True, exist_ok=True)
        self.output_path.write_text(report, encoding="utf-8")
        print(f"[SUCCESS] Documentation saved to: {self.output_path}")
        size_kb = len(report) / 1024
        print(f"[INFO] Markdown size: {size_kb:.1f} KB")
        if size_kb > 1024:
            print("[INFO] Output exceeds 1 MB — consider adding --no-source or lowering --max-source-kb.")
        elif size_kb > 500:
            print("[INFO] Output is large — consider --detail-level minimal to shrink further.")
        elif size_kb > 200:
            print("[INFO] Output is sizable — consider --max-symbols 100 to trim the symbol index.")
        return report


def symbol_list(value: Any) -> List[Any]:
    """Return a safe list for analyzers that historically mixed strings/dicts."""
    if value is None:
        return []
    if isinstance(value, (list, tuple, set)):
        return list(value)
    return [value]


def function_count(analysis: Any) -> int:
    """Count module functions plus methods nested in normalized class records."""
    if not isinstance(analysis, dict):
        return 0
    function_items = symbol_list(analysis.get("functions"))
    total = len(function_items)
    known_names = {symbol_name(item) for item in function_items}
    for cls in symbol_list(analysis.get("classes")):
        if isinstance(cls, dict):
            for method in symbol_list(cls.get("methods")):
                name = symbol_name(method)
                if name not in known_names:
                    known_names.add(name)
                    total += 1
    return total


def symbol_name(value: Any) -> str:
    if isinstance(value, dict):
        return str(value.get("name") or value.get("path") or value.get("method") or value.get("kind") or "Unknown")
    return str(value)


def format_symbol(value: Any) -> str:
    if isinstance(value, dict):
        name = escape_inline(symbol_name(value))
        details: List[str] = []
        if value.get("method") and value.get("path"):
            details.append(f"{value['method']} {value['path']}")
        elif value.get("params") is not None:
            details.append("(" + ", ".join(escape_inline(str(item)) for item in symbol_list(value.get("params"))) + ")")
        for key in ("extends", "inherits", "bases", "kind"):
            if value.get(key):
                details.append(f"{key}: {escape_inline(str(value[key]))}")
        methods = symbol_list(value.get("methods"))
        if methods:
            details.append("methods: " + ", ".join(escape_inline(symbol_name(method)) for method in methods[:8]))
        if value.get("line"):
            details.append(f"line {value['line']}")
        return f"`{name}`" + (f" — {'; '.join(details)}" if details else "")
    return f"`{escape_inline(symbol_name(value))}`"


def escape_inline(value: str) -> str:
    return str(value).replace("`", "\\`").replace("\n", " ")


def escape_table(value: str) -> str:
    return escape_inline(value).replace("|", "\\|")


def anchor(value: str) -> str:
    normalized = re.sub(r"[^\w -]", "", str(value), flags=re.UNICODE).strip().lower().replace(" ", "-")
    return normalized or "file"


def fence_language(extension: str, language: str) -> str:
    values = {".py": "python", ".php": "php", ".js": "javascript", ".jsx": "jsx", ".ts": "typescript", ".tsx": "tsx", ".css": "css", ".scss": "scss", ".html": "html", ".json": "json", ".md": "markdown", ".sql": "sql", ".sh": "bash", ".yaml": "yaml", ".yml": "yaml", ".xml": "xml", ".go": "go", ".java": "java", ".rs": "rust", ".rb": "ruby", ".swift": "swift", ".kt": "kotlin", ".sol": "solidity"}
    return values.get(extension.lower(), language.lower() if language else "text")


def parse_args(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    """Parse command-line options with defaults tuned for token-efficient AI code understanding."""
    examples = (
        "Examples:\n"
        "  py generate-docs.py                    # Scans current directory and outputs AGENTS.md\n"
        "  py generate-docs.py C:\\Projects\\app  # Scans specified folder and outputs AGENTS.md"
    )
    parser = argparse.ArgumentParser(
        prog="generate-docs.py",
        description=(
            "Create a token-efficient AGENTS.md file from a project folder for AI code assistants. "
            "Defaults to scanning the current directory and writing AGENTS.md with optimized token limits."
        ),
        epilog=examples,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "project_path",
        nargs="?",
        default=".",
        metavar="PROJECT_FOLDER",
        help="Project folder to scan (default: current directory).",
    )
    parser.add_argument(
        "--output", "-o",
        metavar="PATH",
        help=(
            "Markdown output path. The default is AGENTS.md inside PROJECT_FOLDER."
        ),
    )
    parser.add_argument(
        "--no-source",
        action="store_true",
        help="Do not embed source excerpts; generate only the compact map and symbol index.",
    )
    css_group = parser.add_mutually_exclusive_group()
    css_group.add_argument(
        "--exclude-css",
        dest="exclude_css",
        action="store_true",
        default=True,
        help="Exclude CSS/SCSS/SASS/LESS files (default: enabled for token economy).",
    )
    css_group.add_argument(
        "--include-css",
        dest="exclude_css",
        action="store_false",
        help="Include CSS/SCSS/SASS/LESS files when visual styling is relevant.",
    )
    font_group = parser.add_mutually_exclusive_group()
    font_group.add_argument(
        "--exclude-fonts", "--exclude-font",
        dest="exclude_fonts",
        action="store_true",
        default=True,
        help="Exclude font files (default: enabled).",
    )
    font_group.add_argument(
        "--include-fonts",
        dest="exclude_fonts",
        action="store_false",
        help="Do not apply the explicit font exclusion.",
    )
    parser.add_argument(
        "--max-source-chars",
        type=int,
        default=2500,
        metavar="N",
        help=(
            "Maximum source characters embedded per file (default: 2500 for token economy). "
            "Use 0 for unlimited source; --no-source disables source completely."
        ),
    )
    parser.add_argument(
        "--detail-level",
        choices=["full", "standard", "minimal"],
        dest="detail_level",
        default=None,
        help=(
            "Override the auto-chosen detail tier. Defaults are chosen by project size "
            "(<=50 files: full, <=200: standard, else minimal). The tier controls the "
            "source budget, symbol-index cap, and per-file detail."
        ),
    )
    parser.add_argument(
        "--max-source-kb",
        type=int,
        default=None,
        metavar="KB",
        help=(
            "Global budget for ALL embedded source, in KB. When set, source excerpts are "
            "distributed across files until the budget is exhausted. Overrides the tier default."
        ),
    )
    parser.add_argument(
        "--max-symbols",
        type=int,
        default=None,
        metavar="N",
        help="Cap the number of rows in the Global Symbol Index (default by tier: 400/200/100).",
    )
    parser.add_argument(
        "--max-file-size-kb",
        type=int,
        default=1024,
        metavar="KB",
        help=(
            "Skip files larger than KB while scanning (default: 1024 KB). "
            "Use 0 for no file-size limit."
        ),
    )
    parser.add_argument(
        "--exclude-dir", "-ed",
        action="append",
        default=[],
        metavar="NAME",
        help=(
            "Exclude all directories with this NAME anywhere in the project tree. "
            "Useful for broad blanket exclusions like 'assets', 'examples', or 'tests'. "
            "Repeat this flag for multiple names. "
            "Example: --exclude-dir tests --exclude-dir legacy"
        ),
    )
    parser.add_argument(
        "--exclude-path", "-ep",
        action="append",
        default=[],
        metavar="PATH",
        help=(
            "Exclude one specific folder at a given relative PATH from the project root. "
            "Useful for precise exclusions like 'app/cache' or 'public/uploads'. "
            "Unlike --exclude-dir, this only matches the exact path, not every folder with that name. "
            "Repeat this flag for multiple paths. "
            "Example: --exclude-path app/cache --exclude-path vendor/old-lib"
        ),
    )
    parser.add_argument(
        "--verbose", "-v",
        action="store_true",
        help="Enable verbose output to log every file processed and skipped during scanning.",
    )
    parser.add_argument(
        "--max-tree-depth",
        type=int,
        default=4,
        metavar="N",
        help="Maximum directory depth displayed in the tree (default: 4).",
    )
    parser.add_argument(
        "--signatures",
        action="store_true",
        help=(
            "Include function parameters (and docstring first-lines where available) in the "
            "global symbol index and per-file listings. Adds a little token cost but gives the "
            "AI the call signature without opening the source excerpt."
        ),
    )
    parser.add_argument(
        "--follow-symlinks",
        action="store_true",
        help=(
            "Follow symbolic links during scanning. By default symlinks are skipped to avoid "
            "infinite recursion and cross-repo confusion. Enable this for monorepos that use "
            "symlinked packages."
        ),
    )
    return parser.parse_args(argv)


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = parse_args(argv)
    project = Path(args.project_path).expanduser()
    if not project.exists():
        print(f"[ERROR] Path does not exist: {project}", file=sys.stderr)
        return 2
    if not project.is_dir():
        print(f"[ERROR] Path is not a directory: {project}", file=sys.stderr)
        return 2
    try:
        generator = UltimateProjectDocumentationGenerator(
            str(project), output_path=args.output, include_source=not args.no_source,
            max_source_chars=args.max_source_chars, max_file_size_kb=args.max_file_size_kb,
            extra_ignored_dirs=args.exclude_dir, extra_ignored_paths=args.exclude_path,
            max_tree_depth=args.max_tree_depth,
            exclude_css=args.exclude_css, exclude_fonts=args.exclude_fonts,
            verbose=args.verbose, signatures=args.signatures, follow_symlinks=args.follow_symlinks,
            detail_level=args.detail_level, max_source_kb=args.max_source_kb, max_symbols=args.max_symbols,
        )
        generator.generate_documentation()
    except ScanCancelled:
        print("[INFO] Scan cancelled by user.", file=sys.stderr)
        return 130
    except (OSError, ValueError) as exc:
        print(f"[ERROR] {exc}", file=sys.stderr)
        return 1
    print("[SUCCESS] Documentation generation complete!")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
