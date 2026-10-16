// app-logic.js — Se carga SOLO después de un login exitoso.
// Contiene toda la lógica de matrícula, calificaciones, informes y control financiero.

// ============================================================
// SEGURIDAD: limpieza de texto libre antes de insertarlo en
// pantalla. Campos como Observaciones, datos de Encargados o
// Reflexiones Docentes los puede escribir un docente y luego
// los ve un administrador — sin esto, alguien podría escribir
// código malicioso en vez de texto normal y robar la sesión de
// quien lo visualice. SIEMPRE usar esta función al insertar
// texto libre de la base de datos dentro de innerHTML.
// ============================================================
function escapeHTML(texto) {
    if (texto === null || texto === undefined) return '';
    return String(texto)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// ============================================================
// NORMALIZACIÓN ESTRICTA para comparar nombres de docentes y
// nombres de materias entre módulos (Matrícula, Directorio/Carga
// y Calificar). Ignora tildes, mayúsculas/minúsculas y espacios
// sobrantes (incl. espacios dobles), para que una diferencia de
// captura (ej. "María José " vs "Maria Jose") no provoque que un
// estudiante desaparezca de la planilla de un docente.
// SIEMPRE usar esta función (nunca "===" directo) al comparar
// nombres de docentes o nombres de materias entre módulos.
// ============================================================
function normalizarTexto(texto) {
    if (texto === null || texto === undefined) return '';
    return String(texto)
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // quita tildes
        .toLowerCase()
        .trim()
        .replace(/\s+/g, ' ');
}

// ============================================================
// FUENTE ÚNICA DE VERDAD (de verdad): dado un docente y la lista
// de estudiantes activos ya consultada, calcula el set de
// materias que imparte en la realidad. Es una función PURA (no
// hace consultas a Supabase), para poder reutilizarla tanto en
// "Directorio y Carga" como en la restricción de "Calificar" sin
// duplicar la lógica de comparación en dos sitios distintos
// (la duplicación anterior era la causa real de inconsistencias:
// un ajuste en un sitio no se reflejaba en el otro).
// ============================================================
function calcularMateriasDeDocente(nombreDocente, estudiantes) {
    const materiasPermitidas = new Set();
    const nombreNorm = normalizarTexto(nombreDocente);
    if (!nombreNorm || !estudiantes) return materiasPermitidas;

    estudiantes.forEach(est => {
        Object.entries(CAMPO_DOCENTE_POR_MATERIA).forEach(([materia, campo]) => {
            if (est[campo] && normalizarTexto(est[campo]) === nombreNorm) materiasPermitidas.add(materia);
        });
        if (est.instrumento_principal && normalizarTexto(est.docente_asignado) === nombreNorm) {
            materiasPermitidas.add(est.instrumento_principal);
        }
        if (est.instrumento_segundo && est.instrumento_segundo !== 'Ninguno' && normalizarTexto(est.docente_segundo) === nombreNorm) {
            materiasPermitidas.add(est.instrumento_segundo);
        }
    });

    return materiasPermitidas;
}


        // ============================================================
        // ENVÍO REAL DE INFORMES POR CORREO (EmailJS conectado a
        // slmontessori@gmail.com). Sustituya estos 3 valores por los
        // que le entregue su cuenta de EmailJS — vea las instrucciones
        // que le indiqué aparte. Mientras estén así, el sistema queda
        // en modo prueba (mensaje simulado, no se envía nada real).
        // ============================================================
        const EMAILJS_PUBLIC_KEY  = 'PEGUE_AQUI_SU_PUBLIC_KEY';
        const EMAILJS_SERVICE_ID  = 'PEGUE_AQUI_SU_SERVICE_ID';
        const EMAILJS_TEMPLATE_ID = 'PEGUE_AQUI_SU_TEMPLATE_ID';
        const EMAILJS_MODO_PRUEBA = EMAILJS_PUBLIC_KEY.startsWith('PEGUE_AQUI');
        if (window.emailjs && !EMAILJS_MODO_PRUEBA) {
            emailjs.init({ publicKey: EMAILJS_PUBLIC_KEY });
        }

        let usuarioRolActual = 'docente';
        let docenteTipoActual = 'artistico'; 
        let docenteEspecialidadGlobal = '';
        let docenteNombreGlobal = '';
        let docenteCicloGlobal = 'Ambos Ciclos';
        let usuarioEmailGlobal = ''; // correo de quien tiene la sesión abierta, para dejar rastro de auditoría en cada guardado
        let modoVistaDocente = false; // true = un admin está viendo el sistema "como docente" (ver mi carga académica)
        let anioLectivoActivo = 2026;

        // =====================================================================
        // FUENTE ÚNICA DE VERDAD PARA LA CARGA ACADÉMICA REAL
        // Este mapeo conecta cada materia de "Calificar" con el campo real de
        // asignación de docente guardado en la matrícula del estudiante.
        // Tanto "Directorio y Carga" como la restricción de "Calificar" para
        // el rol Docente usan EXACTAMENTE esta misma fuente, para que ambos
        // módulos siempre muestren información consistente entre sí.
        // =====================================================================
        const INSTRUMENTOS_INDIVIDUALES = ['Piano', 'Guitarra', 'Ukulele', 'Batería', 'Bajo', 'Canto'];
        const CAMPO_DOCENTE_POR_MATERIA = {
            'Solfeo': 'docente_solfeo',
            'Taller de Percusión': 'docente_percursion',
            'Danza': 'docente_danza',
            'Artes Plásticas': 'docente_plasticas',
            'Edufi': 'docente_edufi',
            'Inglés': 'docente_ingles',
            'Español': 'docente_academico',
            'Matemáticas': 'docente_academico',
            'Ciencias': 'docente_academico',
            'Estudios Sociales': 'docente_academico',
            'Conducta': 'docente_academico'
        };

        function nombreMateriaLimpio(valorOpcion) {
            return valorOpcion.replace('[Artística] ', '').replace('[Académica] ', '').trim();
        }

        // =====================================================================
        // CRUCE ÚNICO DE NOTAS Y REFLEXIONES
        //
        // Por qué existe: cada pantalla buscaba las notas a su manera. El informe
        // al hogar tolera variantes (busca por cédula y normaliza el nombre de la
        // materia), pero la hoja de calificar exigía coincidencia EXACTA de
        // materia + período + año, así que una reflexión guardada con la materia
        // sin prefijo ("Danza" en vez de "[Artística] Danza"), con el período
        // escrito distinto o en otro año lectivo aparecía en el informe y NO en la
        // hoja. Las pantallas de listas e historial, además, no mostraban
        // reflexiones ni docente. Ahora todas usan estas mismas funciones.
        // =====================================================================
        const MATERIAS_ACADEMICAS = ['Español', 'Matemáticas', 'Ciencias', 'Estudios Sociales', 'Conducta', 'Inglés'];
        const MATERIAS_SIN_REFLEXION = ['Solfeo', 'Taller de Percusión', 'Español', 'Matemáticas', 'Ciencias', 'Estudios Sociales'];
        // Mismo orden institucional que usa el informe al hogar.
        const ORDEN_MATERIAS = ['Español', 'Matemáticas', 'Ciencias', 'Estudios Sociales', 'Inglés', 'Conducta', 'Artes Plásticas', 'Danza', ...INSTRUMENTOS_INDIVIDUALES, 'Solfeo', 'Edufi', 'Taller de Percusión'];

        function normalizarPeriodo(p) {
            const n = normalizarTexto(p);
            if (n.startsWith('primer') || n.startsWith('1')) return 'Primer Periodo';
            if (n.startsWith('segundo') || n.startsWith('2')) return 'Segundo Periodo';
            return String(p || '');
        }

        function periodoOpuesto(p) {
            return normalizarPeriodo(p) === 'Primer Periodo' ? 'Segundo Periodo' : 'Primer Periodo';
        }

        // "[Artística] Danza", "Danza", "danza " y "[artistica] DANZA" son la misma materia.
        function nombreLimpioMateria(m) {
            return String(m || '').replace(/^\s*\[[^\]]*\]\s*/, '').trim();
        }
        function claveMateria(m) {
            return normalizarTexto(nombreLimpioMateria(m));
        }
        function valorMateriaCanonico(nombre) {
            return (MATERIAS_ACADEMICAS.includes(nombre) ? '[Académica] ' : '[Artística] ') + nombre;
        }
        function materiaRequiereReflexion(m) {
            return !MATERIAS_SIN_REFLEXION.some(x => normalizarTexto(x) === claveMateria(m));
        }

        // Docente titular de una materia para un estudiante, según su matrícula
        // (la misma regla que ya usaba el informe al hogar para "Docente: ...").
        function docenteDeMateria(est, materia) {
            if (!est) return '';
            const clave = claveMateria(materia);
            for (const [nombre, campo] of Object.entries(CAMPO_DOCENTE_POR_MATERIA)) {
                if (normalizarTexto(nombre) !== clave) continue;
                const d = est[campo];
                return (d && d !== 'No lleva' && d !== 'Ninguno') ? String(d) : '';
            }
            for (const instr of INSTRUMENTOS_INDIVIDUALES) {
                if (normalizarTexto(instr) !== clave) continue;
                if (est.instrumento_principal === instr) return est.docente_asignado || '';
                if (est.instrumento_segundo === instr) return est.docente_segundo || '';
            }
            return '';
        }

        // Materias que le corresponden a un estudiante según su matrícula.
        function materiasDelEstudiante(est) {
            const lista = [];
            Object.entries(CAMPO_DOCENTE_POR_MATERIA).forEach(([nombre, campo]) => {
                const d = est[campo];
                if (d && d !== 'No lleva' && d !== 'Ninguno') lista.push(valorMateriaCanonico(nombre));
            });
            if (est.docente_ingles && est.docente_ingles !== 'No lleva') lista.push(valorMateriaCanonico('Inglés'));
            [est.instrumento_principal, est.instrumento_segundo].forEach(instr => {
                if (instr && INSTRUMENTOS_INDIVIDUALES.includes(instr)) lista.push(valorMateriaCanonico(instr));
            });
            return [...new Set(lista)];
        }

        function agruparNotasPorEstudiante(filas) {
            const mapa = new Map();
            (filas || []).forEach(n => {
                const k = String(n.cedula_estudiante);
                if (!mapa.has(k)) mapa.set(k, []);
                mapa.get(k).push(n);
            });
            return mapa;
        }

        // Busca la nota de UN estudiante para una materia y un período, tolerando
        // variantes de escritura. Si hay varias candidatas elige la mejor: primero
        // la del año indicado, luego la que tiene el nombre de materia exacto y,
        // por último, la modificada más recientemente.
        //   otroAnio       -> la fila existe pero en otro año lectivo
        //   materiaAntigua -> la fila existe pero con el nombre de materia no estándar
        function resolverNota(notasDelEstudiante, materia, periodo, anio) {
            const anioBuscado = Number(anio || anioLectivoActivo);
            const clave = claveMateria(materia);
            const per = normalizarPeriodo(periodo);
            const canonico = valorMateriaCanonico(nombreLimpioMateria(materia));
            let mejor = null, mejorPuntaje = -1;
            (notasDelEstudiante || []).forEach(n => {
                if (claveMateria(n.materia) !== clave) return;
                if (normalizarPeriodo(n.periodo) !== per) return;
                const puntaje = (Number(n.anio_lectivo) === anioBuscado ? 4 : 0) + (n.materia === canonico ? 2 : 0) + (n.periodo === per ? 1 : 0);
                if (puntaje > mejorPuntaje || (puntaje === mejorPuntaje && String(n.modificado_en || '') > String(mejor.modificado_en || ''))) {
                    mejor = n; mejorPuntaje = puntaje;
                }
            });
            if (!mejor) return null;
            return { fila: mejor, otroAnio: Number(mejor.anio_lectivo) !== anioBuscado, materiaAntigua: mejor.materia !== canonico };
        }

        function textoFechaHora(iso) {
            if (!iso) return '';
            const f = new Date(iso);
            if (isNaN(f.getTime())) return '';
            return f.toLocaleDateString('es-CR', { day: '2-digit', month: '2-digit', year: 'numeric' }) + ' ' + f.toLocaleTimeString('es-CR', { hour: '2-digit', minute: '2-digit' });
        }

        // Promedio numérico de una fila de notas (null si no hay nota real).
        function promedioNumerico(fila) {
            if (!fila || fila.promedio === null || fila.promedio === undefined || fila.promedio === '') return null;
            const n = Number(fila.promedio);
            return isNaN(n) ? null : n;
        }

        function posicionMateria(m) {
            const i = ORDEN_MATERIAS.findIndex(n => normalizarTexto(n) === claveMateria(m));
            return i === -1 ? 999 : i;
        }

        // Materias distintas (sin repetir por variantes de escritura) que un estudiante
        // tiene con nota guardada, en orden institucional y sin las que "No lleva".
        function materiasUnicasConNota(notasEst, est) {
            const mapa = new Map();
            (notasEst || []).forEach(n => {
                const k = claveMateria(n.materia);
                if (mapa.has(k)) return;
                const entrada = Object.entries(CAMPO_DOCENTE_POR_MATERIA).find(([nombre]) => normalizarTexto(nombre) === k);
                if (est && entrada && est[entrada[1]] === 'No lleva') return;
                mapa.set(k, n.materia);
            });
            return [...mapa.values()].sort((a, b) => posicionMateria(a) - posicionMateria(b));
        }

        // Asigna el valor de un <select>; si ese valor no está entre sus opciones (por
        // ejemplo un docente que ya no aparece en el Directorio) lo agrega, para que el
        // select no quede en blanco y al guardar no se borre el docente ya asignado.
        function fijarValorSelect(el, valor) {
            if (!el) return;
            const v = (valor === null || valor === undefined) ? '' : String(valor);
            if (v !== '' && !Array.from(el.options).some(o => o.value === v)) {
                const opt = document.createElement('option');
                opt.value = v;
                opt.textContent = v;
                el.appendChild(opt);
            }
            el.value = v;
        }

        // Celda CSV segura: comillas dobles escapadas y sin que Excel interprete
        // un texto que empiece con = + - @ como fórmula.
        function csvCelda(valor) {
            let t = (valor === null || valor === undefined) ? '' : String(valor);
            if (/^[=+\-@\t\r]/.test(t)) t = "'" + t;
            return '"' + t.replace(/"/g, '""') + '"';
        }

        // ---- Piezas visuales de la hoja de calificar (período "opuesto") ----
        function htmlBloqueOtroPeriodo(est, materia, periodoNombre, res) {
            const docente = docenteDeMateria(est, materia);
            let cuerpo;
            if (!res) {
                cuerpo = '<span style="color: #94a3b8;">sin nota registrada todavía</span>';
            } else {
                const f = res.fila;
                const hayNota = f.promedio !== null && f.promedio !== undefined && f.promedio !== '';
                const nota = hayNota ? `<b>${escapeHTML(f.promedio)}</b>` : '<span style="color: #b45309;">sin nota</span>';
                const com = f.comentario ? ` — “${escapeHTML(f.comentario)}”` : '';
                const prof = docente ? `<div style="color: #64748b; margin-top: 2px;">Prof. ${escapeHTML(docente)}</div>` : '';
                const aviso = res.otroAnio ? `<div style="color: #b45309; margin-top: 2px;">⚠ Registro guardado en el año lectivo ${escapeHTML(f.anio_lectivo)}</div>` : '';
                cuerpo = `${nota}${com}${prof}${aviso}`;
            }
            return `<div class="otro-periodo" style="margin-top: 6px; padding: 6px 8px; background: #f1f5f9; border-left: 3px solid #94a3b8; border-radius: 4px; font-size: 11px; line-height: 1.35; color: #475569; white-space: normal;"><b>${escapeHTML(periodoNombre)}:</b> ${cuerpo}</div>`;
        }
        function htmlAvisoOtroAnio(res) {
            const f = res.fila;
            const detalle = `${f.promedio !== null && f.promedio !== undefined ? 'nota ' + escapeHTML(f.promedio) : ''}${f.comentario ? ' — “' + escapeHTML(f.comentario) + '”' : ''}`;
            return `<div style="margin-top: 6px; padding: 6px 8px; background: #fffbeb; border-left: 3px solid #d97706; border-radius: 4px; font-size: 11px; line-height: 1.35; color: #92400e; white-space: normal;">⚠ Este período tiene un registro guardado en el año lectivo ${escapeHTML(f.anio_lectivo)} (${detalle}). No es del año activo, por eso no se carga en las casillas.</div>`;
        }
        function htmlAvisoMateriaAntigua() {
            return `<div style="margin-top: 4px; font-size: 10px; color: #92400e; white-space: normal;">⚠ Registro guardado con el nombre de materia antiguo; al guardar se actualiza.</div>`;
        }

        // ============================================================
        // EXPORTAR A WORD (.doc editable) CON LOS LOGOS INCRUSTADOS
        //
        // Por qué antes no salían los logos: el .doc se armaba como una página
        // web cuyas imágenes eran RUTAS RELATIVAS ("ces%20montessori%20encabezado
        // .jpeg"). Al guardar el archivo en la computadora (Descargas) Word busca
        // esas imágenes junto al .doc, no las encuentra y deja el espacio vacío.
        //
        // Ahora cada imagen se descarga, se convierte a base64 y se guarda DENTRO
        // del mismo archivo (formato MHTML: un solo archivo con el texto y las
        // imágenes adentro, que Word abre como cualquier .doc). Así el documento
        // se puede mover, enviar por correo o editar en cualquier computadora y
        // los logos y firmas siempre van incluidos.
        // ============================================================

        // Interruptor de respaldo. true  = las imágenes viajan DENTRO del archivo (lo
        // recomendado para Microsoft Word). false = formato anterior (página web
        // simple), pero con la dirección completa de internet de cada imagen en
        // vez de la ruta relativa: sirve para programas que no abren el formato de
        // un solo archivo (LibreOffice, etc.), con la condición de abrir el
        // documento con internet para que se vean los logos.
        const WORD_INCRUSTAR_IMAGENES = true;

        // ============================================================
        // ENCABEZADO INSTITUCIONAL de los documentos (informe al hogar,
        // lista oficial y estado de cuenta): "Encabezado Institucional
        // Centro Educativo Shkénuk.png". Va INCRUSTADO en este mismo archivo
        // (ya recortado el margen blanco y ajustado a 1800 px de ancho), así
        // aparece siempre igual en pantalla, PDF, impresión y Word, sin
        // depender de GitHub, de carpetas ni de que la imagen esté pública.
        // Para cambiarlo en el futuro, reemplace el contenido de esta constante.
        // ============================================================
        const LOGO_ENCABEZADO_SRC = 'data:image/jpeg;base64,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';
        const logoEncabezadoListo = Promise.resolve(); // se conserva por compatibilidad con los generadores de documentos

        // Word no entiende las variables CSS (var(--border), etc.): se cambian
        // por su color real para que bordes y títulos salgan igual que en pantalla.
        const COLORES_WORD = {
            '--primary': '#1e293b', '--secondary': '#0f172a', '--accent': '#2563eb',
            '--accent-hover': '#1d4ed8', '--bg-light': '#f8fafc', '--border': '#cbd5e1', '--text': '#334155'
        };

        function bytesABase64(bytes) {
            let binario = '';
            const trozo = 0x8000; // por partes, para no desbordar con imágenes grandes
            for (let i = 0; i < bytes.length; i += trozo) {
                binario += String.fromCharCode.apply(null, bytes.subarray(i, i + trozo));
            }
            return btoa(binario);
        }

        function partirBase64(b64) {
            return b64.replace(/(.{76})/g, '$1\r\n'); // líneas de 76 caracteres, como pide MIME
        }

        function tipoImagenPorExtension(src) {
            const ext = (String(src).split('?')[0].split('.').pop() || '').toLowerCase();
            if (ext === 'png') return 'image/png';
            if (ext === 'gif') return 'image/gif';
            if (ext === 'webp') return 'image/webp';
            return 'image/jpeg';
        }

        // Descarga una imagen (también sirve para las fotos que ya vienen como
        // "data:image/..;base64,..") y la devuelve lista para incrustar.
        async function obtenerImagenComoBase64(src) {
            const resp = await fetch(src);
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            let mime = (resp.headers.get('Content-Type') || '').split(';')[0].trim();
            if (!mime.startsWith('image/')) mime = tipoImagenPorExtension(src);
            const bytes = new Uint8Array(await resp.arrayBuffer());
            return { mime, base64: bytesABase64(bytes) };
        }

        // Codifica texto UTF-8 en "quoted-printable" (la codificación que usa Word
        // al guardar una página web de un solo archivo): los caracteres normales
        // pasan tal cual, los acentos y símbolos salen como =C3=A1, y las líneas
        // se parten a 76 caracteres con "=" al final.
        function codificarQuotedPrintable(texto) {
            const bytes = new TextEncoder().encode(texto);
            const HEX = '0123456789ABCDEF';
            let salida = '';
            let linea = '';
            const agregar = (fragmento) => {
                if (linea.length + fragmento.length > 75) { salida += linea + '=\r\n'; linea = ''; }
                linea += fragmento;
            };
            for (let i = 0; i < bytes.length; i++) {
                const b = bytes[i];
                if (b === 13) continue; // los saltos de línea se normalizan abajo
                if (b === 10) {
                    // un espacio o tab al final de una línea debe codificarse
                    if (linea.endsWith(' ')) linea = linea.slice(0, -1) + '=20';
                    else if (linea.endsWith('\t')) linea = linea.slice(0, -1) + '=09';
                    salida += linea + '\r\n';
                    linea = '';
                } else if (b === 9 || b === 32 || (b >= 33 && b <= 126 && b !== 61)) {
                    agregar(String.fromCharCode(b));
                } else {
                    agregar('=' + HEX[b >> 4] + HEX[b & 15]);
                }
            }
            return salida + linea;
        }

        // Arma el archivo MHTML: primero el documento (HTML) y después una parte
        // por cada imagen, enlazada por su "Content-Location".
        function construirMHTML(htmlCompleto, imagenes) {
            const frontera = '----=_NextPart_CES_' + Date.now().toString(36);
            const CRLF = '\r\n';
            let mime =
                'MIME-Version: 1.0' + CRLF +
                'Content-Type: multipart/related; boundary="' + frontera + '"; type="text/html"' + CRLF + CRLF +
                '--' + frontera + CRLF +
                'Content-Type: text/html; charset="utf-8"' + CRLF +
                'Content-Transfer-Encoding: quoted-printable' + CRLF +
                'Content-Location: file:///C:/fake/documento.htm' + CRLF + CRLF +
                codificarQuotedPrintable(htmlCompleto) + CRLF + CRLF;
            imagenes.forEach(img => {
                mime +=
                    '--' + frontera + CRLF +
                    'Content-Type: ' + img.mime + CRLF +
                    'Content-Transfer-Encoding: base64' + CRLF +
                    'Content-Location: ' + img.ubicacion + CRLF + CRLF +
                    partirBase64(img.base64) + CRLF + CRLF;
            });
            mime += '--' + frontera + '--' + CRLF;
            return mime;
        }

        // Exporta cualquiera de los documentos imprimibles (informe, lista oficial,
        // ficha de matrícula, estado de cuenta) como un archivo .doc editable en
        // Microsoft Word, conservando el formato visual (incluye la tipografía
        // Century Gothic) y con todas las imágenes incrustadas.
        async function exportarComoWord(elementId, nombreArchivoBase) {
            const original = document.getElementById(elementId);
            if (!original) {
                alert('No hay contenido generado para exportar todavía.');
                return;
            }

            try {
                // Se trabaja sobre una copia para no alterar lo que se ve en pantalla.
                const copia = original.cloneNode(true);
                const imgsOriginal = Array.from(original.querySelectorAll('img'));
                const imgsCopia = Array.from(copia.querySelectorAll('img'));

                const partes = [];                 // imágenes a incrustar
                const yaIncrustadas = new Map();   // misma imagen usada dos veces = una sola parte
                let fallidas = 0;
                const ANCHO_MAX_WORD = 680;        // 18 cm: ancho útil de la hoja en Word

                for (let i = 0; i < imgsCopia.length; i++) {
                    const imgCopia = imgsCopia[i];
                    const imgOrig = imgsOriginal[i];
                    const src = imgOrig.currentSrc || imgOrig.src;
                    if (!src) continue;

                    if (!WORD_INCRUSTAR_IMAGENES) {
                        // Respaldo: dirección completa (https://...) de la imagen.
                        imgCopia.removeAttribute('src');
                        imgCopia.removeAttribute('srcset');
                        imgCopia.setAttribute('data-mhtml', new URL(src, location.href).href);
                    } else try {
                        let ubicacion = yaIncrustadas.get(src);
                        if (!ubicacion) {
                            const { mime, base64 } = await obtenerImagenComoBase64(src);
                            const ext = (mime.split('/')[1] || 'jpeg').replace('svg+xml', 'svg');
                            ubicacion = `file:///C:/fake/imagen${partes.length + 1}.${ext}`;
                            partes.push({ ubicacion, mime, base64 });
                            yaIncrustadas.set(src, ubicacion);
                        }
                        // No se pone en "src" todavía (el navegador intentaría cargar
                        // esa ruta interna y llenaría la consola de avisos): se marca
                        // y se convierte a src directamente en el texto final.
                        imgCopia.removeAttribute('src');
                        imgCopia.removeAttribute('srcset');
                        imgCopia.setAttribute('data-mhtml', ubicacion);
                    } catch (errImg) {
                        fallidas++;
                        console.error('No se pudo incrustar la imagen en Word:', src, errImg);
                        // Si una imagen falla, se deja su ruta original (como antes).
                        imgCopia.removeAttribute('src');
                        imgCopia.setAttribute('data-mhtml', imgOrig.getAttribute('src') || src);
                    }

                    // Tamaño explícito en píxeles: Word no entiende max-width ni
                    // object-fit, así que se le da el ancho y alto ya calculados.
                    const natW = imgOrig.naturalWidth || 0;
                    const natH = imgOrig.naturalHeight || 0;
                    let ancho = parseInt(imgCopia.getAttribute('data-ancho-word') || '', 10);
                    if (!ancho) {
                        if (imgCopia.closest('.encabezado-informe-full')) {
                            ancho = ANCHO_MAX_WORD;  // el encabezado va a todo el ancho de la hoja
                        } else {
                            ancho = Math.round(imgOrig.getBoundingClientRect().width) || natW;
                        }
                    }
                    ancho = Math.min(ancho, ANCHO_MAX_WORD);
                    if (ancho && natW && natH) {
                        const alto = Math.round(ancho * natH / natW);
                        imgCopia.setAttribute('width', ancho);
                        imgCopia.setAttribute('height', alto);
                        imgCopia.setAttribute('style', `width: ${ancho}px; height: ${alto}px;`);
                    }
                }

                const estilosWord = `
                @page { size: 21cm 29.7cm; margin: 1.5cm; }
                :root { --primary: #1e293b; --secondary: #0f172a; --accent: #2563eb; --accent-hover: #1d4ed8; --bg-light: #f8fafc; --border: #cbd5e1; --text: #334155; }
                body { font-family: 'Century Gothic', 'CenturyGothic', 'Segoe UI', sans-serif; font-size: 11pt; line-height: 1.35; color: #1e293b; width: 18cm; margin: 0 auto; }
                table { border-collapse: collapse; width: 100%; }
                table, th, td { border: 1px solid #94a3b8; }
                th, td { padding: 6px; text-align: center; }
                th { background-color: #1e293b; color: #ffffff; }
                img { max-width: 100%; }
                .encabezado-informe-full { width: 18cm; margin: 0 0 28px 0; text-align: center; }
                .encabezado-informe-full img { width: 18cm; height: auto; }
                h3, h4 { color: #1e293b; }
            `;

                const cuerpo = copia.innerHTML
                    .replace(/var\((--[a-z-]+)\)/g, (m, v) => COLORES_WORD[v] || m)
                    .replace(/data-mhtml="([^"]*)"/g, 'src="$1"');

                const htmlCompleto = `<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
<head>
<meta http-equiv="Content-Type" content="text/html; charset=utf-8">
<meta charset='utf-8'>
<title>${nombreArchivoBase}</title>
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom><w:DoNotOptimizeForBrowser/></w:WordDocument></xml><![endif]-->
<style>${estilosWord}</style>
</head>
<body>${cuerpo}</body>
</html>`;

                const blob = WORD_INCRUSTAR_IMAGENES
                    ? new Blob([construirMHTML(htmlCompleto, partes)], { type: 'application/msword' })
                    : new Blob(['\ufeff', htmlCompleto], { type: 'application/msword' });
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.download = `${nombreArchivoBase}.doc`;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                setTimeout(() => URL.revokeObjectURL(url), 2000);

                if (fallidas > 0) {
                    alert(`El documento se guardó, pero ${fallidas} imagen(es) no se pudieron incluir (revise su conexión a internet y vuelva a exportar).`);
                }
            } catch (e) {
                console.error('Error al exportar a Word:', e);
                alert('No se pudo generar el archivo de Word: ' + e.message);
            }
        }

        // Calcula, consultando la matrícula real (solo estudiantes activos),
        // el conjunto de materias que un docente específico imparte de verdad.
        async function obtenerCargaRealDocente(nombreDocente) {
            if (!nombreDocente) return new Set();
            try {
                const { data: estudiantes, error } = await supabaseClient.from('estudiantes').select('*').eq('activo', true);
                if (error || !estudiantes) return new Set();
                return calcularMateriasDeDocente(nombreDocente, estudiantes);
            } catch (e) {
                console.error('obtenerCargaRealDocente:', e);
                return new Set();
            }
        }

        function inicializarSelectAnios(idSelect, anioPreseleccionado) {
            const select = document.getElementById(idSelect);
            if (!select) return;
            select.innerHTML = '';
            const anioBase = 2026;
            const anioMarcado = anioPreseleccionado || anioLectivoActivo || anioBase;
            const anioTope = Math.max(anioBase + 6, anioMarcado + 2);
            for (let anio = anioBase; anio <= anioTope; anio++) {
                const opt = document.createElement('option');
                opt.value = anio;
                opt.textContent = `Año Lectivo ${anio}`;
                if (anio === anioMarcado) opt.selected = true;
                select.appendChild(opt);
            }
        }

        function inicializarAniosLectivos() {
            inicializarSelectAnios('filtro-anio-lectivo', anioLectivoActivo);
        }

        // Un usuario es "admin activo" si su rol real es admin Y no está
        // usando el interruptor "Ver como Docente". Esto es solo para la
        // VISTA/navegación; las validaciones de guardado en Supabase siguen
        // revisando usuarioRolActual real, ya que quien alterna la vista
        // sigue siendo administrador de verdad.
        function esAdminActivo() {
            return usuarioRolActual === 'admin' && !modoVistaDocente;
        }

        function cambiarPestana(idSeccion, evt) {
            if (!esAdminActivo()) {
                // Un docente estándar (o un admin en modo "Ver como Docente")
                // solo puede entrar a "Calificar" y a "Seguridad" (para
                // activar su propio doble factor) siempre.
                // A "mimatricula" (Editar Matrícula limitada) solo puede
                // entrar si además es docente académico (mismo criterio que
                // se usa para mostrar/ocultar el botón en verificarRolUsuario).
                const esAcademico = docenteTipoActual === 'academico';
                const tabsPermitidos = esAcademico ? ['calificar', 'historial', 'mimatricula', 'seguridad'] : ['calificar', 'historial', 'seguridad'];
                if (!tabsPermitidos.includes(idSeccion)) {
                    idSeccion = 'calificar';
                }
            }
            if (!document.getElementById(idSeccion)) idSeccion = 'calificar';
            document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
            document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
            document.getElementById(idSeccion).classList.add('active');
            
            const btnTarget = document.querySelector(`.tab-btn[data-tab="${idSeccion}"]`);
            if (btnTarget) btnTarget.classList.add('active');
            else if (evt && evt.currentTarget) evt.currentTarget.classList.add('active');

            if (idSeccion === 'matricula') {
                inicializarAniosLectivos();
                cargarDocentesEnMatricula();
                cargarSelectorEstudiantesEdicion();
                cargarTablaEstudiantesNivel();
                const spanAnio = document.getElementById('span-anio-activo-matricula');
                if (spanAnio) spanAnio.textContent = anioLectivoActivo;
            }
            if (idSeccion === 'registro') {
                inicializarSelectAnios('reg-anio-sel', anioLectivoActivo);
            }
            if (idSeccion === 'configuracion') cargarConfiguracion();
            if (idSeccion === 'docentes') {
                cargarTablaDocentesGeneral();
                cargarTablaCargaAcademica();
                cargarTablaRolesUsuarios();
            }
            if (idSeccion === 'calificar') {
                aplicarRestriccionNivelDocente();
                aplicarRestriccionMateriaDocente();
            }
            if (idSeccion === 'mimatricula') {
                aplicarRestriccionNivelDocente('mimat-nivel-sel');
                cargarMiMatriculaDocente();
            }
            if (idSeccion === 'financiero') {
                inicializarSelectAnios('fin-mensual-anio-sel', anioLectivoActivo);
                inicializarSelectAnios('fin-stats-anio-sel', anioLectivoActivo);
                inicializarSelectMesesFinanciero('fin-stats-mes-sel');
                inicializarSelectMesesFinanciero('fin-rep-mes-sel');
                cargarTablaMatriculaMateriales();
            }
            if (idSeccion === 'seguridad') {
                cargarEstadoMFA();
            }
            if (idSeccion === 'historial') {
                inicializarHistorial();
            }
        }

        function cambiarSubPestanaFinanciero(subId, evt) {
            document.querySelectorAll('#financiero .sub-doc-panel').forEach(el => el.style.display = 'none');
            document.querySelectorAll('#financiero .sub-tab-btn').forEach(el => el.classList.remove('active'));
            document.getElementById(`sub-financiero-${subId}`).style.display = 'block';
            if (evt) evt.currentTarget.classList.add('active');
            if (subId === 'matmat') cargarTablaMatriculaMateriales();
            if (subId === 'mensual') cargarGrillaMensualidades();
            if (subId === 'stats') cargarEstadisticasFinancieras();
        }

        function cambiarSubPestanaDocente(subSubId, evt) {
            document.querySelectorAll('.sub-doc-panel').forEach(el => el.style.display = 'none');
            document.querySelectorAll('#docentes .sub-tab-btn').forEach(el => el.classList.remove('active'));
            document.getElementById(`sub-docentes-${subSubId}`).style.display = 'block';
            if (evt) evt.currentTarget.classList.add('active');
            if (subSubId === 'carga') cargarTablaCargaAcademica();
            if (subSubId === 'roles') cargarTablaRolesUsuarios();
        }

        async function verificarRolUsuario(email) {
            modoVistaDocente = false; // cada login inicia siempre en la vista real de su rol
            // El correo de la sesión de Supabase Auth siempre llega en
            // minúsculas; se normaliza aquí también por seguridad para que
            // SIEMPRE calce con lo guardado en user_roles/docentes (ver
            // guardarRolUsuario y guardarOActualizarDocente).
            const emailNorm = (email || '').trim().toLowerCase();
            usuarioEmailGlobal = emailNorm; // queda disponible para el registro de auditoría al guardar notas

            try {
                const { data: roleData, error: errRole } = await supabaseClient
                    .from('user_roles')
                    .select('role')
                    .eq('email', emailNorm)
                    .maybeSingle();
                if (errRole) throw errRole;

                if (roleData && roleData.role) {
                    usuarioRolActual = roleData.role.toLowerCase();
                } else {
                    usuarioRolActual = 'docente';
                }

                const { data: docData, error: errDoc } = await supabaseClient
                    .from('docentes')
                    .select('especialidad, nombre, tipo_docente, ciclo_asignado')
                    .eq('correo', emailNorm)
                    .maybeSingle();
                if (errDoc) throw errDoc;

                if (docData) {
                    docenteEspecialidadGlobal = (docData.especialidad || '').toLowerCase().trim();
                    docenteNombreGlobal = (docData.nombre || '').trim();
                    docenteTipoActual = (docData.tipo_docente || 'artistico').toLowerCase();
                    docenteCicloGlobal = docData.ciclo_asignado || 'Ambos Ciclos';
                } else {
                    docenteEspecialidadGlobal = '';
                    docenteNombreGlobal = '';
                    docenteTipoActual = 'artistico';
                    docenteCicloGlobal = 'Ambos Ciclos';
                }
            } catch (e) {
                // Fail-safe DE SEGURIDAD: si Supabase no responde (red caída,
                // RLS, etc.) nunca se asume 'admin' por accidente — se cae
                // siempre al rol con menos permisos y se avisa con claridad,
                // en vez de dejar la pantalla de "Cargando el sistema..."
                // congelada sin explicación.
                usuarioRolActual = 'docente';
                docenteEspecialidadGlobal = '';
                docenteNombreGlobal = '';
                docenteTipoActual = 'artistico';
                docenteCicloGlobal = 'Ambos Ciclos';
                alert('No se pudo verificar el rol de este usuario (problema de red o de permisos). Se ingresó con permisos mínimos de Docente. Intente recargar la página.');
            }

            aplicarVisibilidadPorRol();

            if (usuarioRolActual !== 'admin') {
                cambiarPestana('calificar', null);
            }
        }

        // Aplica la visibilidad de pestañas/botones según el rol real y el
        // interruptor "Ver como Docente". La llama verificarRolUsuario al
        // iniciar sesión, y alternarVistaDocente cada vez que se cambia
        // de vista.
        function aplicarVisibilidadPorRol() {
            const admin = esAdminActivo();

            const badge = document.getElementById('user-role-badge');
            if (badge) {
                if (usuarioRolActual === 'admin' && modoVistaDocente) {
                    badge.innerText = `Rol: ADMIN — Viendo como Docente${docenteEspecialidadGlobal ? ' ('+docenteEspecialidadGlobal+')' : ''}`;
                } else {
                    badge.innerText = `Rol: ${usuarioRolActual.toUpperCase()}${docenteEspecialidadGlobal ? ' ('+docenteEspecialidadGlobal+')' : ''}`;
                }
            }

            const botonesNav = document.querySelectorAll('#app-nav .tab-btn');
            botonesNav.forEach(btn => {
                const rolRequerido = btn.getAttribute('data-role-req');
                if (!admin && rolRequerido === 'admin') {
                    btn.classList.add('hidden-by-role');
                } else {
                    btn.classList.remove('hidden-by-role');
                }
            });

            // "Seguridad" (activar/desactivar el propio doble factor) debe
            // verse SIEMPRE, para cualquier rol — cada quien protege su
            // propia cuenta, sin importar si el botón trae marcado
            // data-role-req="admin" en app-shell.html.
            const botonSeguridad = document.querySelector('.tab-btn[data-tab="seguridad"]');
            if (botonSeguridad) botonSeguridad.classList.remove('hidden-by-role');

            // Un docente académico asignado a un solo ciclo (Primer o Segundo)
            // solo puede ver/editar su propio ciclo en "Mi Matrícula". Si es
            // "Ambos Ciclos" (ej. Inglés, que es el mismo docente en todos los
            // niveles) no se le oculta el botón. Un admin en su vista normal
            // (sin alternar) no ve este botón porque usa "Matrícula" completa.
            const botonMiMatricula = document.querySelector('[data-tab="mimatricula"]');
            if (botonMiMatricula) {
                if (admin || docenteTipoActual !== 'academico') {
                    botonMiMatricula.classList.add('hidden-by-role');
                } else {
                    botonMiMatricula.classList.remove('hidden-by-role');
                }
            }

            // El interruptor aparece para cualquier administrador, permitiéndole
            // alternar entre gestionar todo el sistema y revisar su carga docente.
            const btnAlternar = document.getElementById('btn-alternar-vista');
            if (btnAlternar) {
                if (usuarioRolActual === 'admin') {
                    btnAlternar.style.display = 'inline-block';
                    btnAlternar.innerText = modoVistaDocente ? '⇄ Volver a Administrador' : '⇄ Ver como Docente';
                } else {
                    btnAlternar.style.display = 'none';
                }
            }
        }

        function alternarVistaDocente() {
            modoVistaDocente = !modoVistaDocente;
            aplicarVisibilidadPorRol();
            cambiarPestana(modoVistaDocente ? 'calificar' : 'matricula', null);
        }

        function aplicarRestriccionNivelDocente(idSelect) {
            const selectNivel = document.getElementById(idSelect || 'cal-nivel');
            if (!selectNivel) return;

            if (esAdminActivo() || docenteCicloGlobal === 'Ambos Ciclos') {
                for (let opt of selectNivel.options) {
                    opt.disabled = false;
                    opt.style.display = '';
                }
                return;
            }

            const nivelesPrimerCiclo = ['Primero', 'Segundo', 'Tercero'];
            const nivelesSegundoCiclo = ['Cuarto', 'Quinto', 'Sexto'];
            const nivelesPermitidos = docenteCicloGlobal === 'Primer Ciclo' ? nivelesPrimerCiclo : nivelesSegundoCiclo;

            for (let opt of selectNivel.options) {
                if (!opt.value) continue;
                const permitir = nivelesPermitidos.includes(opt.value);
                opt.disabled = !permitir;
                opt.style.display = permitir ? '' : 'none';
            }

            if (selectNivel.options[selectNivel.selectedIndex] && selectNivel.options[selectNivel.selectedIndex].disabled) {
                selectNivel.value = '';
            }
        }

        async function aplicarRestriccionMateriaDocente() {
            const selectMateria = document.getElementById('cal-materia');
            if (!selectMateria) return;

            const mostrarTodo = () => {
                for (let opt of selectMateria.options) {
                    opt.disabled = false;
                    opt.style.display = '';
                }
            };

            const mostrarSoloCategoria = (categoria) => {
                for (let opt of selectMateria.options) {
                    if (!opt.value) continue;
                    const esAcademica = opt.value.startsWith('[Académica]');
                    const permitir = categoria === 'academico' ? esAcademica : !esAcademica;
                    opt.disabled = !permitir;
                    opt.style.display = permitir ? '' : 'none';
                }
            };

            if (esAdminActivo()) {
                mostrarTodo();
                return;
            }

            // 1) Restricción obligatoria por categoría: un docente académico
            //    solo ve materias académicas, uno artístico solo ve materias
            //    artísticas. Esto SIEMPRE se aplica, sin excepción.
            const categoria = (docenteTipoActual || '').toLowerCase().includes('acad') ? 'academico' : 'artistico';
            mostrarSoloCategoria(categoria);

            // 2) Dentro de su categoría, si la carga real (misma fuente que
            //    "Directorio y Carga") coincide por nombre exacto, se afina
            //    aún más para mostrar solo sus materias asignadas. Si no hay
            //    coincidencia, se deja ver toda su categoría (para que
            //    siempre pueda evaluar, aunque el nombre no calce exacto).
            const materiasReales = docenteNombreGlobal ? await obtenerCargaRealDocente(docenteNombreGlobal) : new Set();

            if (materiasReales.size > 0) {
                const materiasRealesNorm = new Set(Array.from(materiasReales).map(normalizarTexto));
                for (let opt of selectMateria.options) {
                    if (!opt.value || opt.disabled) continue;
                    const nombreMateria = nombreMateriaLimpio(opt.value);
                    const permitirMateria = materiasRealesNorm.has(normalizarTexto(nombreMateria));
                    opt.disabled = !permitirMateria;
                    opt.style.display = permitirMateria ? '' : 'none';
                }
            }

            let primeraValida = '';
            for (let opt of selectMateria.options) {
                if (!opt.disabled && opt.value) {
                    primeraValida = opt.value;
                    break;
                }
            }
            selectMateria.value = primeraValida;
            cargarGrupoParaCalificar();
        }

        

        async function cerrarSesion() {
            await supabaseClient.auth.signOut();
            document.getElementById('app-container').style.display = 'none';
            document.getElementById('login-container').style.display = 'flex';
        }

        async function iniciarSesionUI(email) {
            document.getElementById('login-container').style.display = 'none';
            document.getElementById('app-container').style.display = 'flex';
            document.getElementById('user-email-display').innerText = 'Usuario: ' + email;
            await verificarRolUsuario(email);
            await cargarConfiguracion();
            inicializarAniosLectivos();
            cargarDocentesEnMatricula();
            cargarSelectorEstudiantesEdicion();
            cargarTablaEstudiantesNivel();
            const spanAnio = document.getElementById('span-anio-activo-matricula');
            if (spanAnio) spanAnio.textContent = anioLectivoActivo;
            cargarTablaDocentesGeneral();
            cargarTablaCargaAcademica();
            cargarTablaRolesUsuarios();
        }

        

        function procesarArchivoFoto(event) {
            const file = event.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = function(e) {
                const base64Data = e.target.result;
                document.getElementById('mat-foto-url').value = base64Data;
                const imgPrev = document.getElementById('img-preview-foto');
                const txtPrev = document.getElementById('txt-sin-foto');
                imgPrev.src = base64Data;
                imgPrev.style.display = 'block';
                txtPrev.style.display = 'none';
            };
            reader.readAsDataURL(file);
        }

        async function cargarDocentesEnMatricula() {
            const selAcad = document.getElementById('mat-docente-acad');
            const selAsig = document.getElementById('mat-docente-asig');
            const selSegundoDoc = document.getElementById('mat-docente-segundo');
            const selectsPredefinidos = document.querySelectorAll('.select-docente-predefinido');

            if (!selAcad) return;

            // Si se está EDITANDO un estudiante, se recuerda lo que ya tenía seleccionado para
            // restaurarlo al reconstruir las listas (antes volvían a los valores por defecto).
            const selEditando = document.getElementById('select-estudiante-editar');
            const enEdicionDocentes = !!(selEditando && selEditando.value !== '');
            const valoresPrevios = new Map();
            if (enEdicionDocentes) {
                [selAcad, selAsig, selSegundoDoc, ...selectsPredefinidos].forEach(sel => { if (sel && sel.id) valoresPrevios.set(sel.id, sel.value); });
            }

            selAcad.innerHTML = '<option value="">Cargando académicos...</option>';
            selAsig.innerHTML = '<option value="">Cargando instructores...</option>';
            selSegundoDoc.innerHTML = '<option value="Ninguno">Ninguno / No aplica</option>';

            const { data, error } = await supabaseClient.from('docentes').select('id, nombre, especialidad, tipo_docente');
            if (error || !data) return;

            selAcad.innerHTML = '<option value="">Seleccione profesor académico</option>';
            selAsig.innerHTML = '<option value="">Seleccione instructor</option>';

            let listaNombresDocentes = new Set();
            data.forEach(doc => {
                listaNombresDocentes.add(doc.nombre);
                const opt = document.createElement('option');
                opt.value = doc.nombre;
                opt.textContent = `${doc.nombre} (${doc.especialidad})`;
                
                if (doc.tipo_docente === 'academico') {
                    selAcad.appendChild(opt);
                } else {
                    selAsig.appendChild(opt.cloneNode(true));
                    selSegundoDoc.appendChild(opt);
                }
            });

            selectsPredefinidos.forEach(select => {
                const materia = select.getAttribute('data-materia');
                let valorDefecto = '';
                if (materia === 'Solfeo') valorDefecto = 'Rafael Cativo Romero';
                if (materia === 'Taller de Percusión') valorDefecto = 'Luis De la O Jimenez'; // nombre oficial exacto (Directorio, ID 30)
                if (materia === 'Danza') valorDefecto = 'Vanessa De La O Jimenez';
                if (materia === 'Artes Plásticas') valorDefecto = 'Mirta Castro García';
                if (materia === 'Inglés') valorDefecto = 'Ulises Barajas García';
                if (materia === 'Edufi') valorDefecto = 'Santiago Jimenez';

                select.innerHTML = '';
                if (valorDefecto && !listaNombresDocentes.has(valorDefecto)) {
                    const optDef = document.createElement('option');
                    optDef.value = valorDefecto;
                    optDef.textContent = valorDefecto;
                    select.appendChild(optDef);
                }

                listaNombresDocentes.forEach(nombreDoc => {
                    const opt = document.createElement('option');
                    opt.value = nombreDoc;
                    opt.textContent = nombreDoc;
                    if (nombreDoc === valorDefecto) {
                        opt.selected = true;
                    }
                    select.appendChild(opt);
                });
            });

            if (enEdicionDocentes) {
                valoresPrevios.forEach((valor, id) => { if (valor) fijarValorSelect(document.getElementById(id), valor); });
            }

            // Solfeo, Instrumento principal y Académico se reparten por
            // ciclo (a diferencia de Danza/Percusión/Plásticas/Inglés/Edufi,
            // que son el mismo docente en ambos ciclos). Se aplica solo en
            // matrícula NUEVA — nunca pisa el docente ya guardado de un
            // estudiante que se está editando.
            aplicarDocentePorCicloDefault();
        }

        function nivelACiclo(nivel) {
            return ['Cuarto', 'Quinto', 'Sexto'].includes(nivel) ? 'Segundo Ciclo' : 'Primer Ciclo';
        }

        // OJO al editar esto: el nombre debe coincidir EXACTO (tildes
        // incluidas) con el nombre registrado en Directorio y Carga, o el
        // desplegable simplemente no preselecciona a nadie (no rompe nada,
        // solo no aplica el valor por defecto y hay que asignarlo a mano
        // esa vez).
        const DOCENTE_POR_CICLO = {
            'Primer Ciclo': {
                solfeo: 'Mariangel Matamoros',
                instrumento: 'Mariangel Matamoros',
                academico: 'Jessica Sánchez Azofeifa'
            },
            'Segundo Ciclo': {
                solfeo: 'Rafael Cativo Romero',
                instrumento: 'Rafael Cativo Romero',
                academico: 'Verónica Fernández Mora'
            }
        };

        function aplicarDocentePorCicloDefault() {
            const selectorEdicion = document.getElementById('select-estudiante-editar');
            const enEdicion = selectorEdicion && selectorEdicion.value !== '';
            if (enEdicion) return; // nunca pisa el docente ya asignado a un estudiante existente

            const nivel = document.getElementById('mat-nivel') ? document.getElementById('mat-nivel').value : '';
            const defaults = DOCENTE_POR_CICLO[nivelACiclo(nivel)];
            if (!defaults) return;

            const selSolfeo = document.getElementById('mat-doc-solfeo');
            const selInstr = document.getElementById('mat-docente-asig');
            const selAcad = document.getElementById('mat-docente-acad');
            if (selSolfeo && defaults.solfeo) selSolfeo.value = defaults.solfeo;
            if (selInstr && defaults.instrumento) selInstr.value = defaults.instrumento;
            if (selAcad && defaults.academico) selAcad.value = defaults.academico;
        }

        async function cargarSelectorEstudiantesEdicion() {
            const selectEdit = document.getElementById('select-estudiante-editar');
            if (!selectEdit) return;
            selectEdit.innerHTML = '<option value="">-- Nuevo ingreso (Matrícula regular) --</option>';

            const { data, error } = await supabaseClient.from('estudiantes').select('nombre, cedula, nivel, activo').order('nombre');
            if (error || !data) return;

            data.forEach(est => {
                const opt = document.createElement('option');
                opt.value = est.cedula;
                opt.textContent = `${est.nombre} (Cédula: ${est.cedula} - Nivel: ${est.nivel})${est.activo === false ? ' [OCULTO]' : ''}`;
                selectEdit.appendChild(opt);
            });
        }

        async function filtrarEstudiantesPorCiclo() {
            const cicloFiltro = document.getElementById('filtro-ciclo-general').value;
            const selectEdit = document.getElementById('select-estudiante-editar');
            if (selectEdit) {
                selectEdit.innerHTML = '<option value="">-- Cargando por nivel filtrado --</option>';

                let query = supabaseClient.from('estudiantes').select('nombre, cedula, nivel, activo').order('nombre');
                if (cicloFiltro) {
                    query = query.eq('nivel', cicloFiltro);
                }

                const { data, error } = await query;
                if (error || !data) {
                    selectEdit.innerHTML = '<option value="">-- Sin resultados --</option>';
                } else {
                    selectEdit.innerHTML = '<option value="">-- Seleccione estudiante --</option>';
                    data.forEach(est => {
                        const opt = document.createElement('option');
                        opt.value = est.cedula;
                        opt.textContent = `${est.nombre} (Cédula: ${est.cedula} - Nivel: ${est.nivel})${est.activo === false ? ' [OCULTO]' : ''}`;
                        selectEdit.appendChild(opt);
                    });
                }
            }
            cargarTablaEstudiantesNivel();
        }

        // =====================================================================
        // MI MATRÍCULA — edición limitada para docentes académicos
        // =====================================================================

        async function cargarMiMatriculaDocente() {
            const nivel = document.getElementById('mimat-nivel-sel').value;
            const contenedor = document.getElementById('contenedor-mimatricula-tabla');
            document.getElementById('contenedor-mimatricula-form').style.display = 'none';

            if (!nivel) {
                contenedor.innerHTML = '<p style="color: #64748b;">Seleccione un nivel para ver sus estudiantes.</p>';
                return;
            }

            contenedor.innerHTML = '<p>Cargando estudiantes...</p>';

            const { data, error } = await supabaseClient.from('estudiantes').select('cedula, nombre, nivel').eq('nivel', nivel).eq('activo', true).order('nombre');

            if (error) {
                contenedor.innerHTML = '<p style="color: red;">Error al cargar estudiantes: ' + error.message + '</p>';
                return;
            }

            if (!data || data.length === 0) {
                contenedor.innerHTML = '<p style="color: #64748b;">No hay estudiantes activos en este nivel.</p>';
                return;
            }

            let html = `
                <table class="data-table">
                    <thead><tr><th>Cédula</th><th style="text-align: left;">Nombre</th><th>Acciones</th></tr></thead>
                    <tbody>
            `;
            data.forEach(est => {
                html += `
                    <tr>
                        <td>${escapeHTML(est.cedula)}</td>
                        <td style="text-align: left;"><b>${escapeHTML(est.nombre)}</b></td>
                        <td><button type="button" class="warning-btn" style="padding: 4px 10px; font-size: 11px;" onclick="abrirEdicionMiMatricula('${escapeHTML(est.cedula)}')">Editar Datos</button></td>
                    </tr>
                `;
            });
            html += '</tbody></table>';
            contenedor.innerHTML = html;
        }

        async function abrirEdicionMiMatricula(cedula) {
            const { data, error } = await supabaseClient.from('estudiantes').select('*').eq('cedula', cedula).single();
            if (error || !data) {
                alert('No se pudo cargar la información del estudiante.');
                return;
            }

            document.getElementById('mimat-cedula-actual').value = cedula;
            document.getElementById('mimat-nombre-editando').innerText = `${data.nombre} (Cédula: ${cedula})`;
            document.getElementById('mimat-provincia').value = data.provincia || '';
            document.getElementById('mimat-canton').value = data.canton || '';
            document.getElementById('mimat-distrito').value = data.distrito || '';
            document.getElementById('mimat-dir-detalles').value = data.direccion_detalles || '';
            document.getElementById('mimat-enc1-nombre').value = data.encargado1_nombre || '';
            document.getElementById('mimat-enc1-correo').value = data.encargado1_correo || '';
            document.getElementById('mimat-enc1-cel').value = data.encargado1_cel || '';
            document.getElementById('mimat-enc1-profesion').value = data.encargado1_profesion || '';
            document.getElementById('mimat-enc1-trabajo').value = data.encargado1_trabajo || '';
            document.getElementById('mimat-enc2-nombre').value = data.encargado2_nombre || '';
            document.getElementById('mimat-enc2-correo').value = data.encargado2_correo || '';
            document.getElementById('mimat-enc2-cel').value = data.encargado2_cel || '';
            document.getElementById('mimat-enc2-profesion').value = data.encargado2_profesion || '';
            document.getElementById('mimat-enc2-trabajo').value = data.encargado2_trabajo || '';
            document.getElementById('mimat-observaciones').value = data.observaciones || '';
            document.getElementById('mimat-msg').innerText = '';

            const contenedorForm = document.getElementById('contenedor-mimatricula-form');
            contenedorForm.style.display = 'block';
            contenedorForm.scrollIntoView({ behavior: 'smooth' });
        }

        async function guardarMiMatriculaDocente() {
            const cedula = document.getElementById('mimat-cedula-actual').value;
            if (!cedula) return;

            // Solo se actualizan estos campos — nunca nombre, cédula, nivel,
            // docentes asignados, instrumentos ni foto, por seguridad.
            const datos = {
                provincia: document.getElementById('mimat-provincia').value.trim() || '',
                canton: document.getElementById('mimat-canton').value.trim() || '',
                distrito: document.getElementById('mimat-distrito').value.trim() || '',
                direccion_detalles: document.getElementById('mimat-dir-detalles').value.trim() || '',
                encargado1_nombre: document.getElementById('mimat-enc1-nombre').value.trim() || '',
                encargado1_correo: document.getElementById('mimat-enc1-correo').value.trim() || '',
                encargado1_cel: document.getElementById('mimat-enc1-cel').value.trim() || '',
                encargado1_profesion: document.getElementById('mimat-enc1-profesion').value.trim() || '',
                encargado1_trabajo: document.getElementById('mimat-enc1-trabajo').value.trim() || '',
                encargado2_nombre: document.getElementById('mimat-enc2-nombre').value.trim() || '',
                encargado2_correo: document.getElementById('mimat-enc2-correo').value.trim() || '',
                encargado2_cel: document.getElementById('mimat-enc2-cel').value.trim() || '',
                encargado2_profesion: document.getElementById('mimat-enc2-profesion').value.trim() || '',
                encargado2_trabajo: document.getElementById('mimat-enc2-trabajo').value.trim() || '',
                observaciones: document.getElementById('mimat-observaciones').value.trim() || ''
            };

            const { error } = await supabaseClient.from('estudiantes').update(datos).eq('cedula', cedula);
            const msgSpan = document.getElementById('mimat-msg');

            if (error) {
                msgSpan.style.color = '#991b1b';
                msgSpan.innerText = 'Error al guardar: ' + error.message;
            } else {
                msgSpan.style.color = '#166534';
                msgSpan.innerText = '¡Datos actualizados con éxito!';
            }
        }

        async function cargarTablaEstudiantesNivel() {
            const filtroNivel = document.getElementById('filtro-ciclo-general');
            const chkOcultos = document.getElementById('chk-mostrar-ocultos');
            const contenedor = document.getElementById('contenedor-tabla-estudiantes-nivel');
            if (!contenedor || !filtroNivel || !chkOcultos) return;

            const nivel = filtroNivel.value;
            const mostrarOcultos = chkOcultos.checked;

            contenedor.innerHTML = '<p>Cargando estudiantes...</p>';

            let query = supabaseClient.from('estudiantes').select('cedula, nombre, nivel, activo').order('nombre');
            if (nivel) query = query.eq('nivel', nivel);
            if (!mostrarOcultos) query = query.eq('activo', true);

            const { data, error } = await query;

            if (error) {
                contenedor.innerHTML = '<p style="color: red;">Error al cargar estudiantes: ' + error.message + '</p>';
                return;
            }

            if (!data || data.length === 0) {
                contenedor.innerHTML = '<p style="color: #64748b; text-align: center;">No hay estudiantes que coincidan con este filtro.</p>';
                return;
            }

            let html = `
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>Cédula</th>
                            <th style="text-align: left;">Nombre</th>
                            <th>Nivel</th>
                            <th>Estado</th>
                            <th>Acciones</th>
                        </tr>
                    </thead>
                    <tbody>
            `;

            data.forEach(est => {
                const estaOculto = est.activo === false;
                html += `
                    <tr>
                        <td>${escapeHTML(est.cedula)}</td>
                        <td style="text-align: left;"><b>${escapeHTML(est.nombre)}</b></td>
                        <td>${escapeHTML(est.nivel)}</td>
                        <td><span style="padding: 3px 8px; border-radius: 4px; font-size: 11px; background: ${estaOculto ? '#fef3c7; color: #92400e;' : '#dcfce7; color: #166534;'}">${estaOculto ? 'OCULTO' : 'ACTIVO'}</span></td>
                        <td style="white-space: nowrap;">
                            <button type="button" class="warning-btn" style="padding: 4px 10px; font-size: 11px;" onclick="cargarDatosEstudianteEdicion('${escapeHTML(est.cedula)}')">Editar</button>
                            <button type="button" class="${estaOculto ? 'success-btn' : 'warning-btn'}" style="padding: 4px 10px; font-size: 11px;" onclick="alternarVisibilidadEstudiante('${escapeHTML(est.cedula)}', ${estaOculto})">${estaOculto ? 'Reactivar' : 'Ocultar'}</button>
                            <button type="button" class="danger-btn" data-nombre="${escapeHTML(est.nombre)}" onclick="eliminarEstudiantePermanente('${est.cedula}', this.dataset.nombre)">Eliminar</button>
                        </td>
                    </tr>
                `;
            });

            html += '</tbody></table>';
            contenedor.innerHTML = html;
        }

        async function alternarVisibilidadEstudiante(cedula, reactivar) {
            const mensajeConfirm = reactivar
                ? '¿Reactivar a este estudiante? Volverá a aparecer en listas, calificaciones e informes.'
                : '¿Ocultar a este estudiante? Dejará de aparecer en listas, calificaciones e informes, pero su expediente e historial se conservarán intactos por si regresa a la institución.';

            if (!confirm(mensajeConfirm)) return;

            const { error } = await supabaseClient.from('estudiantes').update({ activo: reactivar }).eq('cedula', cedula);
            if (error) {
                alert('Error al actualizar el estado del estudiante: ' + error.message);
                return;
            }

            cargarTablaEstudiantesNivel();
            cargarSelectorEstudiantesEdicion();
        }

        async function eliminarEstudiantePermanente(cedula, nombre) {
            const primeraConfirmacion = confirm(
                `¿ELIMINAR PERMANENTEMENTE a ${nombre} (Cédula: ${cedula})?\n\n` +
                'Esta acción borrará también todo su historial de calificaciones y NO se puede deshacer.\n\n' +
                'Si solo desea darlo de baja temporalmente conservando su expediente por si regresa, use el botón "Ocultar" en su lugar.'
            );
            if (!primeraConfirmacion) return;

            const segundaConfirmacion = confirm('Confirme una vez más: esta eliminación es DEFINITIVA y no se puede recuperar. ¿Desea continuar?');
            if (!segundaConfirmacion) return;

            if (timerAutoguardadoMatricula) clearTimeout(timerAutoguardadoMatricula); // evita que un autoguardado pendiente vuelva a crear al estudiante
            await supabaseClient.from('notas').delete().eq('cedula_estudiante', cedula);
            await supabaseClient.from('control_financiero').delete().eq('cedula_estudiante', cedula);
            const { error } = await supabaseClient.from('estudiantes').delete().eq('cedula', cedula);

            if (error) {
                alert('Error al eliminar al estudiante: ' + error.message);
                return;
            }

            alert('Estudiante eliminado permanentemente del sistema.');
            cargarTablaEstudiantesNivel();
            cargarSelectorEstudiantesEdicion();
            limpiarFormularioMatricula();
        }

        async function cargarDatosEstudianteEdicion(cedulaDirecta) {
            const selectEdit = document.getElementById('select-estudiante-editar');
            const cedula = cedulaDirecta || (selectEdit ? selectEdit.value : '');
            const btnSubmit = document.getElementById('btn-submit-matricula');
            const inputCedula = document.getElementById('mat-cedula');

            if (!cedula) {
                limpiarFormularioMatricula();
                return;
            }

            if (cedulaDirecta && selectEdit) {
                selectEdit.value = cedulaDirecta;
                document.getElementById('form-matricula').scrollIntoView({ behavior: 'smooth' });
            }

            const { data, error } = await supabaseClient.from('estudiantes').select('*').eq('cedula', cedula).single();
            if (error || !data) {
                alert('No se pudo cargar la información del estudiante.');
                return;
            }

            document.getElementById('mat-nombre').value = data.nombre || '';
            inputCedula.value = data.cedula || '';
            inputCedula.readOnly = true; 
            document.getElementById('mat-fnac').value = data.fecha_nacimiento || '';
            document.getElementById('mat-lugar-nac').value = data.lugar_nacimiento || '';
            document.getElementById('mat-fecha-ingreso').value = data.fecha_ingreso_ces || '';
            document.getElementById('mat-institucion-procedencia').value = data.institucion_procedencia || '';
            if (data.fecha_nacimiento) calcularEdadExacta();
            document.getElementById('mat-nivel').value = data.nivel || 'Primero';
            fijarValorSelect(document.getElementById('mat-docente-acad'), data.docente_academico || '');
            
            if (document.getElementById('mat-doc-solfeo')) fijarValorSelect(document.getElementById('mat-doc-solfeo'), data.docente_solfeo || 'Rafael Cativo Romero');
            if (document.getElementById('mat-doc-percursion')) {
                const noLlevaPercusion = data.docente_percursion === 'No lleva';
                document.getElementById('mat-no-percusion').checked = noLlevaPercusion;
                document.getElementById('mat-doc-percursion').disabled = noLlevaPercusion;
                fijarValorSelect(document.getElementById('mat-doc-percursion'), noLlevaPercusion ? 'Luis De la O Jimenez' : (data.docente_percursion || 'Luis De la O Jimenez'));
            }
            if (document.getElementById('mat-doc-danza')) fijarValorSelect(document.getElementById('mat-doc-danza'), data.docente_danza || 'Vanessa De La O Jimenez');
            if (document.getElementById('mat-doc-plasticas')) fijarValorSelect(document.getElementById('mat-doc-plasticas'), data.docente_plasticas || 'Mirta Castro García');
            if (document.getElementById('mat-doc-ingles')) fijarValorSelect(document.getElementById('mat-doc-ingles'), data.docente_ingles || 'Ulises Barajas García');
            if (document.getElementById('mat-doc-edufi')) fijarValorSelect(document.getElementById('mat-doc-edufi'), data.docente_edufi || 'Santiago Jimenez');

            document.getElementById('mat-instr-principal').value = data.instrumento_principal || '';
            fijarValorSelect(document.getElementById('mat-docente-asig'), data.docente_asignado || '');
            document.getElementById('mat-instr-segundo').value = data.instrumento_segundo || 'Ninguno';
            fijarValorSelect(document.getElementById('mat-docente-segundo'), data.docente_segundo || 'Ninguno');
            document.getElementById('dir-provincia').value = data.provincia || '';
            document.getElementById('dir-canton').value = data.canton || '';
            document.getElementById('dir-distrito').value = data.distrito || '';
            document.getElementById('dir-detalles').value = data.direccion_detalles || '';
            document.getElementById('enc1-nombre').value = data.encargado1_nombre || '';
            document.getElementById('enc1-correo').value = data.encargado1_correo || '';
            document.getElementById('enc1-cel').value = data.encargado1_cel || '';
            document.getElementById('enc1-profesion').value = data.encargado1_profesion || '';
            document.getElementById('enc1-trabajo').value = data.encargado1_trabajo || '';
            document.getElementById('enc2-nombre').value = data.encargado2_nombre || '';
            document.getElementById('enc2-correo').value = data.encargado2_correo || '';
            document.getElementById('enc2-cel').value = data.encargado2_cel || '';
            document.getElementById('enc2-profesion').value = data.encargado2_profesion || '';
            document.getElementById('enc2-trabajo').value = data.encargado2_trabajo || '';
            document.getElementById('mat-observaciones').value = data.observaciones || '';

            const fotoUrlVal = data.foto_url || '';
            document.getElementById('mat-foto-url').value = fotoUrlVal;
            const imgPrev = document.getElementById('img-preview-foto');
            const txtPrev = document.getElementById('txt-sin-foto');
            if (fotoUrlVal) {
                imgPrev.src = fotoUrlVal;
                imgPrev.style.display = 'block';
                txtPrev.style.display = 'none';
            } else {
                imgPrev.src = '';
                imgPrev.style.display = 'none';
                txtPrev.style.display = 'block';
            }

            btnSubmit.innerText = 'Actualizar Datos de Matrícula';
            btnSubmit.className = 'action-btn warning-btn';

            sincronizarNoLlevaPercusionUI();
            generarVistaPreviaMatricula();
        }

        function limpiarFormularioMatricula() {
            if (timerAutoguardadoMatricula) clearTimeout(timerAutoguardadoMatricula); // no guardar nada pendiente del formulario anterior
            document.getElementById('form-matricula').reset();
            document.getElementById('select-estudiante-editar').value = '';
            document.getElementById('mat-cedula').readOnly = false;
            document.getElementById('mat-foto-url').value = '';
            document.getElementById('img-preview-foto').style.display = 'none';
            document.getElementById('txt-sin-foto').style.display = 'block';
            const btnSubmit = document.getElementById('btn-submit-matricula');
            btnSubmit.innerText = 'Guardar Matrícula Rápida';
            btnSubmit.className = 'action-btn';
            document.getElementById('edad-resultado').innerText = 'Seleccione una fecha de nacimiento';
            document.getElementById('mat-doc-percursion').disabled = false;
            document.getElementById('mat-no-percusion').disabled = false;
            document.getElementById('contenedor-vista-previa-matricula').style.display = 'none';
            cargarDocentesEnMatricula();
            sincronizarNoLlevaPercusionUI();
        }

        function confirmarYGuardarMatricula(e) {
            e.preventDefault();
            if (confirm('¿Estás seguro que quieres realizar el cambio?')) {
                guardarOActualizarMatricula();
            }
        }

        async function guardarOActualizarMatricula(silencioso) {
            const cedulaVal = document.getElementById('mat-cedula').value.trim();
            const nombreVal = document.getElementById('mat-nombre').value.trim();

            if (!cedulaVal || !nombreVal) {
                // En automático simplemente espera a que se completen Nombre
                // y Cédula (son obligatorios) — no interrumpe con un alert
                // mientras la persona sigue llenando el formulario.
                if (!silencioso) alert('El Nombre y la Cédula son obligatorios para la matrícula.');
                return;
            }

            const datos = {
                nombre: nombreVal,
                cedula: cedulaVal,
                fecha_nacimiento: document.getElementById('mat-fnac').value || null,
                lugar_nacimiento: document.getElementById('mat-lugar-nac').value.trim() || '',
                fecha_ingreso_ces: document.getElementById('mat-fecha-ingreso').value || null,
                institucion_procedencia: document.getElementById('mat-institucion-procedencia').value.trim() || '',
                nivel: document.getElementById('mat-nivel').value || 'Primero',
                docente_academico: document.getElementById('mat-docente-acad').value || '',
                docente_solfeo: document.getElementById('mat-doc-solfeo').value || '',
                // Automático: si el instrumento principal o el segundo es
                // Batería, el estudiante NO lleva Taller de Percusión (sería
                // redundante) — sin depender de que alguien recuerde marcar
                // la casilla "No lleva" a mano. La casilla manual sigue
                // funcionando para cualquier otro caso puntual que se
                // necesite marcar así.
                docente_percursion: (
                    document.getElementById('mat-no-percusion').checked ||
                    document.getElementById('mat-instr-principal').value === 'Batería' ||
                    document.getElementById('mat-instr-segundo').value === 'Batería'
                ) ? 'No lleva' : (document.getElementById('mat-doc-percursion').value || ''),
                docente_danza: document.getElementById('mat-doc-danza').value || '',
                docente_plasticas: document.getElementById('mat-doc-plasticas').value || '',
                docente_ingles: document.getElementById('mat-doc-ingles').value || '',
                docente_edufi: document.getElementById('mat-doc-edufi').value || '',
                instrumento_principal: document.getElementById('mat-instr-principal').value || '',
                docente_asignado: document.getElementById('mat-docente-asig').value || '',
                instrumento_segundo: document.getElementById('mat-instr-segundo').value || 'Ninguno',
                docente_segundo: document.getElementById('mat-docente-segundo').value || 'Ninguno',
                provincia: document.getElementById('dir-provincia').value.trim() || '',
                canton: document.getElementById('dir-canton').value.trim() || '',
                distrito: document.getElementById('dir-distrito').value.trim() || '',
                direccion_detalles: document.getElementById('dir-detalles').value.trim() || '',
                encargado1_nombre: document.getElementById('enc1-nombre').value.trim() || '',
                encargado1_correo: document.getElementById('enc1-correo').value.trim() || '',
                encargado1_cel: document.getElementById('enc1-cel').value.trim() || '',
                encargado1_profesion: document.getElementById('enc1-profesion').value.trim() || '',
                encargado1_trabajo: document.getElementById('enc1-trabajo').value.trim() || '',
                encargado2_nombre: document.getElementById('enc2-nombre').value.trim() || '',
                encargado2_correo: document.getElementById('enc2-correo').value.trim() || '',
                encargado2_cel: document.getElementById('enc2-cel').value.trim() || '',
                encargado2_profesion: document.getElementById('enc2-profesion').value.trim() || '',
                encargado2_trabajo: document.getElementById('enc2-trabajo').value.trim() || '',
                observaciones: document.getElementById('mat-observaciones').value.trim() || '',
                foto_url: document.getElementById('mat-foto-url').value.trim() || ''
            };

            try {
                const { data: existing } = await supabaseClient.from('estudiantes').select('cedula').eq('cedula', cedulaVal).maybeSingle();

                let error = null;
                if (existing) {
                    const res = await supabaseClient.from('estudiantes').update(datos).eq('cedula', cedulaVal);
                    error = res.error;
                } else {
                    // El autoguardado NO crea un estudiante nuevo mientras la cédula siga incompleta
                    // (antes podía quedar un registro con media cédula si se hacía una pausa al escribir).
                    if (silencioso && cedulaVal.replace(/[\s-]/g, '').length < 9) {
                        mostrarMensaje('mat-msg', 'Guardado automático en espera: complete la cédula del estudiante nuevo.', false);
                        return;
                    }
                    const res = await supabaseClient.from('estudiantes').insert([datos]);
                    error = res.error;
                }

                if (error) {
                    mostrarMensaje('mat-msg', (silencioso ? 'Error al guardar automáticamente: ' : 'Error al guardar en Supabase: ') + error.message, false);
                } else {
                    const cuando = new Date().toLocaleTimeString('es-CR', { hour: '2-digit', minute: '2-digit' });
                    mostrarMensaje('mat-msg', silencioso ? `✓ Guardado automático (${cuando})` : '¡Matrícula rápida guardada con éxito! Puede completar el resto de datos cuando guste.', true);
                    if (!silencioso) {
                        cargarSelectorEstudiantesEdicion();
                        cargarTablaEstudiantesNivel();
                        generarVistaPreviaMatricula();
                    }
                }
            } catch (e) {
                mostrarMensaje('mat-msg', 'Error de red o de permisos al guardar la matrícula: ' + e.message, false);
            }
        }

        // ============================================================
        // GUARDADO AUTOMÁTICO de Matrícula: 2.5 segundos después de dejar
        // de escribir/cambiar cualquier campo del formulario, se guarda
        // solo — sin esperar a que alguien pulse "Guardar". El botón
        // manual sigue funcionando igual (con su confirmación "¿Estás
        // seguro?"); el automático nunca usa alert ni confirm, para no
        // interrumpir mientras se llena el formulario. No actualiza las
        // tablas/listas en cada guardado silencioso (eso sería muy
        // seguido) — esas se refrescan solas al guardar manualmente o al
        // cambiar de estudiante/nivel.
        // ============================================================
        let timerAutoguardadoMatricula = null;

        function programarAutoguardadoMatricula() {
            if (timerAutoguardadoMatricula) clearTimeout(timerAutoguardadoMatricula);
            timerAutoguardadoMatricula = setTimeout(() => {
                guardarOActualizarMatricula(true);
            }, 2500);
        }

        (function inicializarAutoguardadoMatricula() {
            const formMatricula = document.getElementById('form-matricula');
            if (!formMatricula) return;
            // Delegado sobre el formulario completo: cualquier campo que
            // cambie (texto, select, fecha, checkbox, foto) reinicia el
            // conteo de 2.5 segundos, sin tener que engancharse campo por
            // campo.
            formMatricula.addEventListener('input', programarAutoguardadoMatricula);
            formMatricula.addEventListener('change', programarAutoguardadoMatricula);
        })();

        function generarVistaPreviaMatricula() {
            const anioLectivo = document.getElementById('filtro-anio-lectivo').value;
            const nombre = escapeHTML(document.getElementById('mat-nombre').value);
            const cedula = escapeHTML(document.getElementById('mat-cedula').value);
            const fnac = escapeHTML(document.getElementById('mat-fnac').value);
            const lugarNac = escapeHTML(document.getElementById('mat-lugar-nac').value);
            const fechaIngreso = escapeHTML(document.getElementById('mat-fecha-ingreso').value);
            const institucionProcedencia = escapeHTML(document.getElementById('mat-institucion-procedencia').value);
            const edadExactaTexto = escapeHTML(document.getElementById('edad-resultado').innerText);

            // CORREGIDO: Toma el nivel real del formulario de matrícula de forma independiente
            const nivel = escapeHTML(document.getElementById('mat-nivel').value);

            const docenteAcad = escapeHTML(document.getElementById('mat-docente-acad').value);
            const docSolfeo = escapeHTML(document.getElementById('mat-doc-solfeo').value);
            const docPerc = escapeHTML(document.getElementById('mat-doc-percursion').value);
            const docDanza = escapeHTML(document.getElementById('mat-doc-danza').value);
            const docPlast = escapeHTML(document.getElementById('mat-doc-plasticas').value);
            const docIngles = escapeHTML(document.getElementById('mat-doc-ingles').value);
            const docEdufi = escapeHTML(document.getElementById('mat-doc-edufi').value);
            const instr = escapeHTML(document.getElementById('mat-instr-principal').value);
            const docenteInstr = escapeHTML(document.getElementById('mat-docente-asig').value);
            const instrSegundo = escapeHTML(document.getElementById('mat-instr-segundo').value);
            const docenteSegundo = escapeHTML(document.getElementById('mat-docente-segundo').value);
            const prov = document.getElementById('dir-provincia').value;
            const canton = document.getElementById('dir-canton').value;
            const distrito = document.getElementById('dir-distrito').value;
            const detalles = document.getElementById('dir-detalles').value;
            const enc1Nom = document.getElementById('enc1-nombre').value;
            const enc1Correo = document.getElementById('enc1-correo').value;
            const enc1Cel = document.getElementById('enc1-cel').value;
            const enc1Profesion = document.getElementById('enc1-profesion').value;
            const enc1Trabajo = document.getElementById('enc1-trabajo').value;
            const enc2Nom = document.getElementById('enc2-nombre').value;
            const enc2Correo = document.getElementById('enc2-correo').value;
            const enc2Cel = document.getElementById('enc2-cel').value;
            const enc2Profesion = document.getElementById('enc2-profesion').value;
            const enc2Trabajo = document.getElementById('enc2-trabajo').value;
            const observaciones = document.getElementById('mat-observaciones').value;
            const fotoUrl = escapeHTML(document.getElementById('mat-foto-url').value);

            if (!nombre || !cedula) {
                alert('Por favor complete al menos el Nombre y la Cédula.');
                return;
            }

            const contenedorPrev = document.getElementById('contenedor-vista-previa-matricula');
            contenedorPrev.style.display = 'block';
            contenedorPrev.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;" class="no-print">
                    <h3 style="margin: 0; color: var(--primary);">Vista Previa para Revisión (Año ${anioLectivo})</h3>
                    <div>
                        <button type="button" class="action-btn" onclick="window.print()">Imprimir / Guardar PDF</button>
                        <button type="button" class="warning-btn" onclick="exportarComoWord('preview-matricula-impresion', 'Ficha_Matricula_${cedula.replace(/[^\w-]/g, '')}')">Guardar en Word (Editable)</button>
                    </div>
                </div>

                <div class="report-preview" id="preview-matricula-impresion">
                    <div class="report-header">
                        <img src="Logo%20%20CES%202--_n.jpg" alt="Logo Centro Educativo Shkénuk" style="width: 90px; height: 90px; object-fit: contain; flex-shrink: 0;">
                        <div class="school-info" style="flex: 1; margin: 0 15px; text-align: center; min-width: 0;">
                            <h3 style="margin: 0; color: #1e293b; font-size: 18px; text-transform: uppercase;">Registro CES Montessori</h3>
                            <p style="margin: 3px 0; font-size: 11px; color: #64748b;">Ficha Oficial de Matrícula Estudiantil • Año Lectivo: <b>${anioLectivo}</b></p>
                        </div>
                        <div style="width: 70px; height: 85px; border: 1px solid #cbd5e1; border-radius: 4px; overflow: hidden; background: #f8fafc; flex-shrink: 0; position: relative; display: flex; align-items: center; justify-content: center;">
                            ${fotoUrl ? `<img src="${fotoUrl}" style="width: 100%; height: 100%; object-fit: cover; display: block;">` : `<span style="font-size: 9px; color: #94a3b8; text-align: center;">Sin Foto</span>`}
                        </div>
                    </div>

                    <div style="margin-bottom: 15px; background: #f8fafc; padding: 12px; border-radius: 6px; border: 1px solid #cbd5e1; font-size: 12px;">
                        <h4 style="margin-top: 0; color: #1e293b; border-bottom: 1px solid #cbd5e1; padding-bottom: 4px;">1. Datos del Estudiante</h4>
                        <p style="margin: 4px 0;"><b>Nombre Completo:</b> ${nombre}</p>
                        <p style="margin: 4px 0;"><b>Cédula:</b> ${cedula}</p>
                        <p style="margin: 4px 0;"><b>Nivel Educativo:</b> ${nivel}</p>
                        <p style="margin: 4px 0;"><b>Fecha de Nacimiento:</b> ${fnac || 'Pendiente'} — <b>Lugar de Nacimiento:</b> ${lugarNac || 'N/A'}</p>
                        <p style="margin: 4px 0;"><b>Edad Exacta:</b> ${edadExactaTexto}</p>
                        <p style="margin: 4px 0;"><b>Fecha de Ingreso a CES:</b> ${fechaIngreso || 'Pendiente'}</p>
                        <p style="margin: 4px 0;"><b>Institución de Procedencia:</b> ${institucionProcedencia || 'N/A'}</p>
                    </div>

                    <div style="margin-bottom: 15px; background: #f8fafc; padding: 12px; border-radius: 6px; border: 1px solid #cbd5e1; font-size: 12px;">
                        <h4 style="margin-top: 0; color: #1e293b; border-bottom: 1px solid #cbd5e1; padding-bottom: 4px;">2. Dirección y Ubicación</h4>
                        <p style="margin: 4px 0;"><b>Provincia / Cantón / Distrito:</b> ${escapeHTML(prov) || 'Pendiente'}, ${escapeHTML(canton) || ''}, ${escapeHTML(distrito) || ''}</p>
                        <p style="margin: 4px 0;"><b>Otras Señas:</b> ${escapeHTML(detalles) || 'N/A'}</p>
                    </div>

                    <div style="margin-bottom: 15px; background: #f8fafc; padding: 12px; border-radius: 6px; border: 1px solid #cbd5e1; font-size: 12px;">
                        <h4 style="margin-top: 0; color: #1e293b; border-bottom: 1px solid #cbd5e1; padding-bottom: 4px;">3. Información de Encargados</h4>
                        <p style="margin: 4px 0;"><b>Primer Encargado:</b> ${escapeHTML(enc1Nom) || 'Pendiente'} - Correo: ${escapeHTML(enc1Correo) || 'N/A'} - Tel: ${escapeHTML(enc1Cel) || 'N/A'}</p>
                        <p style="margin: 4px 0 4px 15px;">Profesión u Oficio: ${escapeHTML(enc1Profesion) || 'N/A'} — Lugar de Trabajo: ${escapeHTML(enc1Trabajo) || 'N/A'}</p>
                        <p style="margin: 8px 0 4px 0;"><b>Segundo Encargado:</b> ${escapeHTML(enc2Nom) || 'N/A'} - Correo: ${escapeHTML(enc2Correo) || 'N/A'} - Tel: ${escapeHTML(enc2Cel) || 'N/A'}</p>
                        <p style="margin: 4px 0 4px 15px;">Profesión u Oficio: ${escapeHTML(enc2Profesion) || 'N/A'} — Lugar de Trabajo: ${escapeHTML(enc2Trabajo) || 'N/A'}</p>
                    </div>

                    <div style="margin-bottom: 15px; background: #f8fafc; padding: 12px; border-radius: 6px; border: 1px solid #cbd5e1; font-size: 12px; min-height: 60px;">
                        <h4 style="margin-top: 0; color: #1e293b; border-bottom: 1px solid #cbd5e1; padding-bottom: 4px;">4. Observaciones</h4>
                        <p style="margin: 4px 0; white-space: pre-wrap;">${escapeHTML(observaciones) || '—'}</p>
                    </div>

                    <div style="margin-bottom: 15px; background: #f8fafc; padding: 12px; border-radius: 6px; border: 1px solid #cbd5e1; font-size: 12px;">
                        <h4 style="margin-top: 0; color: #1e293b; border-bottom: 1px solid #cbd5e1; padding-bottom: 4px;">5. Asignación Académica, Talleres y Cursos</h4>
                        <p style="margin: 4px 0;"><b>Profesor Académico:</b> ${docenteAcad || 'No asignado'}</p>
                        <p style="margin: 4px 0;"><b>Solfeo:</b> ${docSolfeo} | <b>Taller de Percusión:</b> ${docPerc}</p>
                        <p style="margin: 4px 0;"><b>Danza:</b> ${docDanza} | <b>Artes Plásticas:</b> ${docPlast}</p>
                        <p style="margin: 4px 0;"><b>Inglés:</b> ${docIngles} | <b>Educación Física:</b> ${docEdufi}</p>
                        <p style="margin: 4px 0;"><b>Instrumento Principal:</b> ${instr || 'Ninguno'} (Profesor: ${docenteInstr || 'No asignado'})</p>
                        <p style="margin: 4px 0;"><b>Segundo Instrumento (Pago):</b> ${instrSegundo && instrSegundo !== 'Ninguno' ? `${instrSegundo} (Profesor: ${docenteSegundo})` : 'Ninguno'}</p>
                    </div>
                </div>
            `;
            contenedorPrev.scrollIntoView({ behavior: 'smooth' });
        }

        async function descargarMatriculaExcel() {
            const { data, error } = await supabaseClient.from('estudiantes').select('*').order('nivel');
            if (error || !data || data.length === 0) {
                alert('No hay registros de matrícula para exportar.');
                return;
            }

            let csvContent = '\uFEFFCédula,Nombre,Nivel,Estado,Fecha Nacimiento,Lugar Nacimiento,Fecha Ingreso CES,Institución de Procedencia,Profesor Académico,Solfeo,Taller Percusión,Danza,Artes Plásticas,Inglés,Educación Física,Instrumento Principal,Profesor Instrumento,Segundo Instrumento (Pago),Profesor 2do Instrumento,Provincia,Cantón,Distrito,Dirección Detalles,Encargado 1,Correo Encargado 1,Celular Encargado 1,Profesión Encargado 1,Trabajo Encargado 1,Encargado 2,Correo Encargado 2,Celular Encargado 2,Profesión Encargado 2,Trabajo Encargado 2,Observaciones\n';

            data.forEach(est => {
                const fila = [
                    csvCelda(est.cedula),
                    csvCelda(est.nombre),
                    csvCelda(est.nivel),
                    csvCelda(est.activo === false ? 'Oculto' : 'Activo'),
                    csvCelda(est.fecha_nacimiento),
                    csvCelda(est.lugar_nacimiento),
                    csvCelda(est.fecha_ingreso_ces),
                    csvCelda(est.institucion_procedencia),
                    csvCelda(est.docente_academico),
                    csvCelda(est.docente_solfeo),
                    csvCelda(est.docente_percursion),
                    csvCelda(est.docente_danza),
                    csvCelda(est.docente_plasticas),
                    csvCelda(est.docente_ingles),
                    csvCelda(est.docente_edufi),
                    csvCelda(est.instrumento_principal),
                    csvCelda(est.docente_asignado),
                    csvCelda(est.instrumento_segundo),
                    csvCelda(est.docente_segundo),
                    csvCelda(est.provincia),
                    csvCelda(est.canton),
                    csvCelda(est.distrito),
                    csvCelda(est.direccion_detalles),
                    csvCelda(est.encargado1_nombre),
                    csvCelda(est.encargado1_correo),
                    csvCelda(est.encargado1_cel),
                    csvCelda(est.encargado1_profesion),
                    csvCelda(est.encargado1_trabajo),
                    csvCelda(est.encargado2_nombre),
                    csvCelda(est.encargado2_correo),
                    csvCelda(est.encargado2_cel),
                    csvCelda(est.encargado2_profesion),
                    csvCelda(est.encargado2_trabajo),
                    csvCelda(est.observaciones)
                ].join(',');
                csvContent += fila + '\n';
            });

            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.setAttribute('href', url);
            link.setAttribute('download', 'Matricula_Estudiantil_Shkenuk.csv');
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }

        async function cargarConfiguracion() {
            const { data, error } = await supabaseClient.from('configuracion_periodos').select('*').eq('id', 1).single();
            if (error || !data) return;

            anioLectivoActivo = data.anio_lectivo_activo || 2026;
            const inputAnio = document.getElementById('cfg-anio-activo');
            if (inputAnio) inputAnio.value = anioLectivoActivo;

            if (data.p1_inicio) document.getElementById('cfg-p1-inicio').value = data.p1_inicio;
            if (data.p1_fin) document.getElementById('cfg-p1-fin').value = data.p1_fin;
            if (data.vac_inicio) document.getElementById('cfg-vac-inicio').value = data.vac_inicio;
            if (data.vac_fin) document.getElementById('cfg-vac-fin').value = data.vac_fin;
            if (data.p2_inicio) document.getElementById('cfg-p2-inicio').value = data.p2_inicio;
            if (data.p2_fin) document.getElementById('cfg-p2-fin').value = data.p2_fin;
            if (data.festival_fecha) document.getElementById('cfg-festival-fecha').value = data.festival_fecha;
            if (data.festival_lugar) document.getElementById('cfg-festival-lugar').value = data.festival_lugar;
            if (data.graduacion_fecha) document.getElementById('cfg-graduacion-fecha').value = data.graduacion_fecha;
            if (data.graduacion_lugar) document.getElementById('cfg-graduacion-lugar').value = data.graduacion_lugar;
        }

        function confirmarYGuardarConfiguracion(e) {
            e.preventDefault();
            if (usuarioRolActual !== 'admin') {
                alert('Acceso denegado: Solo los administradores pueden modificar la configuración institucional.');
                return;
            }
            if (confirm('¿Estás seguro que quieres realizar el cambio?')) {
                guardarConfiguracion();
            }
        }

        async function guardarConfiguracion() {
            const datos = {
                id: 1,
                anio_lectivo_activo: parseInt(document.getElementById('cfg-anio-activo').value, 10) || 2026,
                p1_inicio: document.getElementById('cfg-p1-inicio').value || null,
                p1_fin: document.getElementById('cfg-p1-fin').value || null,
                vac_inicio: document.getElementById('cfg-vac-inicio').value || null,
                vac_fin: document.getElementById('cfg-vac-fin').value || null,
                p2_inicio: document.getElementById('cfg-p2-inicio').value || null,
                p2_fin: document.getElementById('cfg-p2-fin').value || null,
                festival_fecha: document.getElementById('cfg-festival-fecha').value || null,
                festival_lugar: document.getElementById('cfg-festival-lugar').value,
                graduacion_fecha: document.getElementById('cfg-graduacion-fecha').value || null,
                graduacion_lugar: document.getElementById('cfg-graduacion-lugar').value
            };
            try {
                const { error } = await supabaseClient.from('configuracion_periodos').upsert([datos]);
                if (error) {
                    mostrarMensaje('cfg-msg', 'Error: ' + error.message, false);
                    return;
                }
                // CRÍTICO: sin esta línea, la variable en memoria quedaba
                // desactualizada tras guardar, y notas/matrícula/financiero
                // seguían usando el Año Lectivo Activo viejo hasta recargar
                // la página por completo.
                anioLectivoActivo = datos.anio_lectivo_activo;
                inicializarAniosLectivos();
                const spanAnio = document.getElementById('span-anio-activo-matricula');
                if (spanAnio) spanAnio.textContent = anioLectivoActivo;
                mostrarMensaje('cfg-msg', '¡Configuración guardada con éxito!', true);
            } catch (e) {
                mostrarMensaje('cfg-msg', 'Error de red o de permisos al guardar: ' + e.message, false);
            }
        }

        async function cargarTablaDocentesGeneral() {
            const contenedor = document.getElementById('contenedor-tabla-docentes');
            if (!contenedor) return;
            contenedor.innerHTML = '<p>Cargando lista de docentes...</p>';

            const { data, error } = await supabaseClient.from('docentes').select('*').order('nombre');
            if (error) {
                contenedor.innerHTML = '<p style="color: red;">Error al cargar docentes: ' + error.message + '</p>';
                return;
            }

            if (!data || data.length === 0) {
                contenedor.innerHTML = '<p style="color: #64748b;">No hay docentes registrados en el sistema.</p>';
                return;
            }

            let html = `
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>Nombre Completo</th>
                            <th>Tipo</th>
                            <th>Especialidad / Materia</th>
                            <th>Correo Electrónico</th>
                            <th>Teléfono</th>
                            <th>Acciones</th>
                        </tr>
                    </thead>
                    <tbody>
            `;

            data.forEach(doc => {
                html += `
                    <tr>
                        <td style="text-align: left;"><b>${escapeHTML(doc.nombre)}</b></td>
                        <td><span style="padding: 3px 8px; border-radius: 4px; font-size: 11px; background: ${doc.tipo_docente === 'academico' ? '#e0f2fe; color: #0369a1;' : '#fef3c7; color: #92400e;'}">${escapeHTML(String(doc.tipo_docente || '').toUpperCase())}</span></td>
                        <td>${escapeHTML(doc.especialidad)}</td>
                        <td>${escapeHTML(doc.correo)}</td>
                        <td>${escapeHTML(doc.telefono)}</td>
                        <td>
                            <button class="warning-btn" style="padding: 4px 10px; font-size: 11px;" onclick="cargarDocenteParaEdicionPorId('${doc.id}')">Editar</button>
                            <button class="danger-btn" onclick="eliminarDocente('${doc.id}')">Eliminar</button>
                        </td>
                    </tr>
                `;
            });

            html += `</tbody></table>`;
            contenedor.innerHTML = html;
        }

        async function cargarTablaCargaAcademica() {
            const contenedor = document.getElementById('contenedor-carga-academica');
            if (!contenedor) return;
            contenedor.innerHTML = '<p>Calculando carga académica desde Supabase...</p>';

            const { data: docentes, error: errDoc } = await supabaseClient.from('docentes').select('*').order('nombre');
            const { data: estudiantes, error: errEst } = await supabaseClient.from('estudiantes').select('*').eq('activo', true);

            if (errDoc || errEst) {
                contenedor.innerHTML = '<p style="color: red;">Error al consultar los datos para la carga académica.</p>';
                return;
            }

            if (!docentes || docentes.length === 0) {
                contenedor.innerHTML = '<p style="color: #64748b;">No hay docentes en el directorio.</p>';
                return;
            }

            let html = `
                <p style="font-size: 12px; color: #64748b; margin-top: 0;">Esta tabla se calcula directamente desde las asignaciones reales guardadas en la Matrícula (solo estudiantes activos), por lo que siempre coincide con lo que cada docente puede calificar en la pestaña "Calificar".</p>
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>Docente</th>
                            <th>Tipo</th>
                            <th>Especialidad Registrada</th>
                            <th>Materias Reales Asignadas (según Matrícula)</th>
                            <th>Estudiantes a Cargo / Niveles</th>
                        </tr>
                    </thead>
                    <tbody>
            `;

            docentes.forEach(doc => {
                const nom = (doc.nombre || '').trim();
                const nomNorm = normalizarTexto(nom);
                let countEst = 0;
                let detalleGrupos = [];
                // Misma función pura que usa "Calificar" (calcularMateriasDeDocente),
                // para que esta tabla y lo que el docente ve en Calificar coincidan
                // siempre, incluso si hay pequeñas diferencias de captura.
                const materiasReales = calcularMateriasDeDocente(nom, estudiantes || []);

                if (estudiantes) {
                    estudiantes.forEach(est => {
                        const esDeEsteDocente = Object.entries(CAMPO_DOCENTE_POR_MATERIA).some(([, campo]) => est[campo] && normalizarTexto(est[campo]) === nomNorm)
                            || (est.instrumento_principal && normalizarTexto(est.docente_asignado) === nomNorm)
                            || (est.instrumento_segundo && est.instrumento_segundo !== 'Ninguno' && normalizarTexto(est.docente_segundo) === nomNorm);

                        if (esDeEsteDocente) {
                            countEst++;
                            if (!detalleGrupos.includes(est.nivel)) {
                                detalleGrupos.push(est.nivel);
                            }
                        }
                    });
                }

                const listaMateriasStr = materiasReales.size > 0 ? escapeHTML(Array.from(materiasReales).join(', ')) : '<span style="color:#991b1b;">Sin carga real asignada en Matrícula</span>';
                const tipoDocenteTexto = (doc.tipo_docente || 'artístico').toString();

                html += `
                    <tr>
                        <td style="text-align: left;"><b>${escapeHTML(doc.nombre)}</b><br><small>${escapeHTML(doc.correo)}</small></td>
                        <td><span style="padding: 3px 8px; border-radius: 4px; font-size: 11px; background: ${tipoDocenteTexto === 'academico' ? '#e0f2fe; color: #0369a1;' : '#fef3c7; color: #92400e;'}">${escapeHTML(tipoDocenteTexto.toUpperCase())}</span></td>
                        <td>${escapeHTML(doc.especialidad)}</td>
                        <td style="text-align: left;">${listaMateriasStr}</td>
                        <td><b>${countEst} estudiantes</b><br><small>Niveles: ${detalleGrupos.length > 0 ? escapeHTML(detalleGrupos.join(', ')) : 'Ninguno asignado'}</small></td>
                    </tr>
                `;
            });

            html += `</tbody></table>`;
            contenedor.innerHTML = html;
        }

        async function cargarTablaRolesUsuarios() {
            const contenedor = document.getElementById('contenedor-tabla-roles');
            if (!contenedor) return;
            contenedor.innerHTML = '<p>Cargando roles activos...</p>';

            const { data, error } = await supabaseClient.from('user_roles').select('*').order('email');
            if (error) {
                contenedor.innerHTML = '<p style="color: red;">Error al cargar roles: ' + error.message + '</p>';
                return;
            }

            if (!data || data.length === 0) {
                contenedor.innerHTML = '<p style="color: #64748b;">No hay roles registrados en la base de datos.</p>';
                return;
            }

            let html = `
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>Correo Electrónico</th>
                            <th>Rol Asignado</th>
                            <th>Acciones</th>
                        </tr>
                    </thead>
                    <tbody>
            `;

            data.forEach(item => {
                html += `
                    <tr>
                        <td style="text-align: left;"><b>${escapeHTML(item.email)}</b></td>
                        <td><span style="padding: 3px 8px; border-radius: 4px; font-size: 11px; background: ${item.role === 'admin' ? '#dcfce7; color: #166534;' : '#fef3c7; color: #92400e;'}">${escapeHTML(String(item.role || '').toUpperCase())}</span></td>
                        <td>
                            <button class="danger-btn" data-email="${escapeHTML(item.email)}" onclick="eliminarRolUsuario(this.dataset.email)">Eliminar Rol</button>
                        </td>
                    </tr>
                `;
            });

            html += `</tbody></table>`;
            contenedor.innerHTML = html;
        }

        async function guardarRolUsuario(e) {
            e.preventDefault();
            if (usuarioRolActual !== 'admin') {
                alert('Acceso denegado: Solo los administradores pueden gestionar roles.');
                return;
            }

            // CRÍTICO: el correo se normaliza a minúsculas y sin espacios.
            // Supabase Auth guarda/compara el email de sesión siempre en
            // minúsculas; si aquí quedaba "Juan@Correo.com" o con un espacio
            // de más, verificarRolUsuario() nunca encontraba coincidencia y
            // ese docente caía silenciosamente al rol/tipo por defecto.
            const email = document.getElementById('rol-email-input').value.trim().toLowerCase();
            const role = document.getElementById('rol-select-input').value;

            try {
                const { error } = await supabaseClient.from('user_roles').upsert([{ email, role }], { onConflict: 'email' });

                if (error) {
                    mostrarMensaje('rol-msg', 'Error al guardar el rol: ' + error.message, false);
                } else {
                    mostrarMensaje('rol-msg', `¡Rol '${role}' asignado exitosamente a ${email}!`, true);
                    document.getElementById('form-asignar-rol').reset();
                    cargarTablaRolesUsuarios();
                }
            } catch (e) {
                mostrarMensaje('rol-msg', 'Error de red al guardar el rol: ' + e.message, false);
            }
        }

        async function eliminarRolUsuario(email) {
            if (usuarioRolActual !== 'admin') {
                alert('Acceso denegado: Solo los administradores pueden eliminar roles.');
                return;
            }
            if (!confirm(`¿Está seguro de eliminar el rol asignado a ${email}? Quedará con acceso estándar (docente).`)) return;

            const { error } = await supabaseClient.from('user_roles').delete().eq('email', email);
            if (error) {
                alert('Error al eliminar rol: ' + error.message);
            } else {
                alert('Rol eliminado correctamente.');
                cargarTablaRolesUsuarios();
            }
        }

        // Busca el docente por id y llena el formulario (así el botón "Editar" no necesita
        // pasar nombre/correo/teléfono dentro del HTML, donde una comilla los rompía).
        async function cargarDocenteParaEdicionPorId(id) {
            const { data, error } = await supabaseClient.from('docentes').select('*').eq('id', id).single();
            if (error || !data) {
                alert('No se pudo cargar la información del docente.');
                return;
            }
            cargarDocenteParaEdicion(data.id, data.nombre || '', data.correo || '', data.telefono || '', data.especialidad || '', data.tipo_docente || 'artistico', data.ciclo_asignado || 'Ambos Ciclos');
        }

        function cargarDocenteParaEdicion(id, nombre, correo, telefono, especialidad, tipo, ciclo) {
            if (usuarioRolActual !== 'admin') {
                alert('Acceso denegado: Solo los administradores pueden editar docentes.');
                return;
            }
            document.getElementById('doc-id').value = id;
            document.getElementById('doc-nombre').value = nombre;
            document.getElementById('doc-correo').value = correo;
            document.getElementById('doc-tel').value = telefono;
            document.getElementById('doc-esp').value = especialidad;
            document.getElementById('doc-tipo').value = tipo;
            document.getElementById('doc-ciclo').value = ciclo || 'Ambos Ciclos';

            document.getElementById('docente-legend-title').innerText = `Editando Docente: ${nombre}`;
            document.getElementById('btn-submit-docente').innerText = 'Actualizar Datos del Docente';
            document.getElementById('btn-submit-docente').className = 'action-btn warning-btn';
            
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }

        function limpiarFormularioDocente() {
            document.getElementById('form-docente-general').reset();
            document.getElementById('doc-id').value = '';
            document.getElementById('doc-ciclo').value = 'Ambos Ciclos';
            document.getElementById('docente-legend-title').innerText = 'Registrar Nuevo Docente';
            document.getElementById('btn-submit-docente').innerText = 'Registrar Docente';
            document.getElementById('btn-submit-docente').className = 'action-btn';
        }

        function confirmarYGuardarDocente(e) {
            e.preventDefault();
            if (usuarioRolActual !== 'admin') {
                alert('Acceso denegado: Solo los administradores pueden registrar o modificar docentes.');
                return;
            }
            if (confirm('¿Estás seguro que quieres realizar el cambio?')) {
                guardarOActualizarDocente();
            }
        }

        async function guardarOActualizarDocente() {
            const id = document.getElementById('doc-id').value;
            const datos = {
                nombre: document.getElementById('doc-nombre').value.trim(),
                // Normalizado a minúsculas/sin espacios: debe calzar exacto
                // con el correo de sesión que usa verificarRolUsuario().
                correo: document.getElementById('doc-correo').value.trim().toLowerCase(),
                telefono: document.getElementById('doc-tel').value.trim(),
                especialidad: document.getElementById('doc-esp').value,
                tipo_docente: document.getElementById('doc-tipo').value,
                ciclo_asignado: document.getElementById('doc-ciclo').value
            };

            try {
                let error = null;
                if (id) {
                    const res = await supabaseClient.from('docentes').update(datos).eq('id', id);
                    error = res.error;
                } else {
                    const res = await supabaseClient.from('docentes').insert([datos]);
                    error = res.error;
                }

                if (error) {
                    mostrarMensaje('doc-msg', 'Error: ' + error.message, false);
                } else {
                    mostrarMensaje('doc-msg', id ? '¡Docente actualizado exitosamente!' : '¡Docente registrado exitosamente!', true);
                    limpiarFormularioDocente();
                    cargarTablaDocentesGeneral();
                    cargarTablaCargaAcademica();
                    cargarDocentesEnMatricula();
                }
            } catch (e) {
                mostrarMensaje('doc-msg', 'Error de red al guardar el docente: ' + e.message, false);
            }
        }

        async function eliminarDocente(id) {
            if (usuarioRolActual !== 'admin') {
                alert('Acceso denegado: Solo los administradores pueden eliminar docentes.');
                return;
            }
            if (!confirm('¿Está seguro de que desea eliminar este docente del sistema?')) return;

            const { error } = await supabaseClient.from('docentes').delete().eq('id', id);
            if (error) {
                alert('Error al eliminar: ' + error.message);
            } else {
                alert('Docente eliminado correctamente.');
                cargarTablaDocentesGeneral();
                cargarTablaCargaAcademica();
                cargarDocentesEnMatricula();
            }
        }

        function calcularEdadExacta() {
            const fechaNacVal = document.getElementById('mat-fnac').value;
            const resultadoDiv = document.getElementById('edad-resultado');
            if (!fechaNacVal) {
                resultadoDiv.innerText = 'Seleccione una fecha de nacimiento';
                return;
            }
            const [anioN, mesN, diaN] = fechaNacVal.split('-').map(Number);
            const fnac = new Date(anioN, mesN - 1, diaN); // fecha local, sin desfase de zona horaria
            const hoy = new Date();
            let anos = hoy.getFullYear() - fnac.getFullYear();
            let meses = hoy.getMonth() - fnac.getMonth();
            let dias = hoy.getDate() - fnac.getDate();
            if (dias < 0) {
                meses--;
                const ultimoMes = new Date(hoy.getFullYear(), hoy.getMonth(), 0);
                dias += ultimoMes.getDate();
            }
            if (meses < 0) {
                anos--;
                meses += 12;
            }
            resultadoDiv.innerText = `${anos} años, ${meses} meses y ${dias} días`;
        }

        async function mostrarMensaje(elementId, texto, esExito) {
            const el = document.getElementById(elementId);
            el.className = 'notification ' + (esExito ? 'success' : 'error');
            el.innerText = texto;
            el.style.display = 'block';
            setTimeout(() => { el.style.display = 'none'; }, 5000);
        }

        function obtenerRubrosMateria(materia) {
            if (materia.includes('Conducta')) {
                return [
                    { id: 'asertividad', label: 'Asertividad', peso: 0.20 },
                    { id: 'cooperacion', label: 'Cooperación', peso: 0.05 },
                    { id: 'presentacion', label: 'Presentación', peso: 0.05 },
                    { id: 'resp_fisico', label: 'Respeto Físico', peso: 0.20 },
                    { id: 'resp_verbal', label: 'Respeto Verbal', peso: 0.20 },
                    { id: 'no_verbal', label: 'No Verbal', peso: 0.10 },
                    { id: 'resp_psico', label: 'Respeto Psicológico', peso: 0.20 }
                ];
            } else if (materia.includes('Inglés')) {
                return [
                    { id: 'puntuality', label: 'Punctuality', peso: 0.05 },
                    { id: 'phonics', label: 'Phonics & Pron.', peso: 0.10 },
                    { id: 'projects', label: 'Projects', peso: 0.10 },
                    { id: 'test', label: 'Test', peso: 0.20 },
                    { id: 'notebook', label: 'Notebook', peso: 0.10 },
                    { id: 'oral', label: 'Oral Class', peso: 0.35 },
                    { id: 'attendance', label: 'Attendance', peso: 0.10 }
                ];
            } else if (materia.includes('Danza')) {
                return [
                    { id: 'puntualidad', label: 'Puntualidad', peso: 0.10 },
                    { id: 'seguimiento', label: 'Coreografía', peso: 0.20 },
                    { id: 'preparacion', label: 'Preparación', peso: 0.10 },
                    { id: 'participacion', label: 'Participación', peso: 0.20 },
                    { id: 'concentracion', label: 'Concentración', peso: 0.10 },
                    { id: 'aportes', label: 'Creatividad', peso: 0.20 },
                    { id: 'asistencia', label: 'Asistencia', peso: 0.10 }
                ];
            } else if (materia.includes('Artes Plásticas')) {
                return [
                    { id: 'asistencia', label: 'Asistencia', peso: 0.25 },
                    { id: 'trabajo_clase', label: 'Trabajo en clase', peso: 0.75 }
                ];
            } else if (materia.includes('Taller de Percusión')) {
                return [
                    { id: 'cotidiano', label: 'Cotidiano', peso: 0.60 },
                    { id: 'materiales', label: 'Materiales', peso: 0.20 },
                    { id: 'asistencia', label: 'Asistencia', peso: 0.20 }
                ];
            } else if (materia.includes('Solfeo')) {
                return [
                    { id: 'autorregulacion', label: 'Autorregulación', peso: 0.40 },
                    { id: 'cotidiano', label: 'Cotidiano', peso: 0.60 }
                ];
            } else if (materia.includes('Edufi')) {
                return [
                    { id: 'asistencia', label: 'Asistencia', peso: 0.50 },
                    { id: 'respeto', label: 'Respeto', peso: 0.25 },
                    { id: 'disposicion', label: 'Disposición', peso: 0.25 }
                ];
            } else if (materia.includes('Académica')) {
                return [
                    { id: 'cotidiano', label: 'Cotidiano', peso: 0.50 },
                    { id: 'pruebas', label: 'Pruebas', peso: 0.30 },
                    { id: 'extraclase', label: 'Extraclase', peso: 0.10 },
                    { id: 'asistencia', label: 'Asistencia', peso: 0.10 }
                ];
            } else {
                return [
                    { id: 'cotidiano', label: 'Cotidiano', peso: 0.60 },
                    { id: 'asistencia', label: 'Asistencia/Participación', peso: 0.40 }
                ];
            }
        }

        async function cargarGrupoParaCalificar() {
            const nivel = document.getElementById('cal-nivel').value;
            const materia = document.getElementById('cal-materia').value;
            const periodo = document.getElementById('cal-periodo').value;
            const contenedor = document.getElementById('contenedor-grupo-calificar');

            if (!nivel || !materia) {
                contenedor.innerHTML = '<p style="color: #64748b; text-align: center;">Seleccione el Nivel y la Asignatura para desplegar la planilla.</p>';
                return;
            }

            contenedor.innerHTML = '<p>Cargando estudiantes y componentes...</p>';

            let instrumentoEspecifico = null;
            INSTRUMENTOS_INDIVIDUALES.forEach(instr => {
                if (materia.includes(instr)) {
                    instrumentoEspecifico = instr;
                }
            });

            let queryEstudiantes = supabaseClient.from('estudiantes').select('*').eq('nivel', nivel).eq('activo', true);
            const { data: estudiantesRaw, error: errEst } = await queryEstudiantes;

            if (errEst) {
                contenedor.innerHTML = '<p style="color: red;">Error al cargar estudiantes: ' + errEst.message + '</p>';
                return;
            }

            let estudiantes = estudiantesRaw || [];
            if (instrumentoEspecifico && estudiantes.length > 0) {
                estudiantes = estudiantes.filter(est => est.instrumento_principal === instrumentoEspecifico || est.instrumento_segundo === instrumentoEspecifico);
            }

            // Excluye estudiantes marcados como "No lleva" esta materia (ej.
            // Taller de Percusión), para que no aparezcan en la planilla ni se les genere
            // nota, y así tampoco aparezcan en su Informe al Hogar.
            const campoMateriaActual = CAMPO_DOCENTE_POR_MATERIA[nombreMateriaLimpio(materia)];
            if (campoMateriaActual) {
                estudiantes = estudiantes.filter(est => est[campoMateriaActual] !== 'No lleva');
            }

            if (estudiantes.length === 0) {
                contenedor.innerHTML = `<p style="text-align: center; color: #991b1b;">No hay estudiantes matriculados${instrumentoEspecifico ? ` con el instrumento ${instrumentoEspecifico}` : ''} en el nivel ${nivel}.</p>`;
                return;
            }

            // Notas de TODOS los períodos de estos estudiantes. Ya no se filtra por el
            // texto exacto de materia/período/año en la consulta: el cruce se hace aquí
            // con resolverNota(), igual que en el informe y en el historial, para que
            // lo que se ve en una pantalla se vea en todas.
            let notasAlumnos = [];
            try {
                const { data: dataNotas, error: errNotas } = await supabaseClient.from('notas').select('*').in('cedula_estudiante', estudiantes.map(e => e.cedula));
                if (errNotas) throw errNotas;
                notasAlumnos = dataNotas || [];
            } catch (errCarga) {
                contenedor.innerHTML = '<p style="color: red;">Error al cargar las notas: ' + escapeHTML(errCarga.message || errCarga) + '</p>';
                return;
            }
            const notasPorEstudiante = agruparNotasPorEstudiante(notasAlumnos);
            const periodoOtro = periodoOpuesto(periodo);

            const rubros = obtenerRubrosMateria(materia);
            const esAcademicaPura = materia.includes('Español') || materia.includes('Matemáticas') || materia.includes('Ciencias') || materia.includes('Estudios Sociales');
            const esSolfeoPercusion = materia.includes('Solfeo') || materia.includes('Taller de Percusión');
            const llevaComentario = !esSolfeoPercusion && !esAcademicaPura;
            const esConducta = materia.includes('Conducta');

            // ------------------------------------------------------------------
            // Distribución de la planilla (pensada para que la reflexión del
            // docente se lea COMPLETA en la misma vista):
            //  - La tabla ocupa todo el ancho disponible (display: table) y va
            //    dentro de un contenedor con scroll horizontal por si la
            //    pantalla es muy angosta (celular).
            //  - "Reflexiones Docentes" es la columna flexible (width: 100%):
            //    se queda con TODO el espacio sobrante, y su caja es un
            //    <textarea> que parte el texto en 2 o más renglones y crece
            //    sola hasta mostrar el comentario completo.
            //  - "Acción" queda como columna angosta en el extremo derecho: el
            //    botón Guardar y, apilados debajo, el estado y la auditoría.
            //  - Casillas de notas más angostas y nombre del estudiante con
            //    salto de línea, para liberar ancho a favor de la reflexión.
            // ------------------------------------------------------------------
            const celdaBase = 'padding: 8px 5px;';
            let html = `
                <h3 style="color: var(--primary); margin-top: 20px;">Planilla de Calificación: ${nivel} - ${materia} (${periodo})${instrumentoEspecifico ? ` [Instrumento: ${instrumentoEspecifico}]` : ''}</h3>
                <div class="planilla-scroll" style="overflow-x: auto; width: 100%;">
                <table class="data-table" style="display: table; width: 100%;">
                    <thead>
                        <tr>
                            <th style="${celdaBase} white-space: normal; min-width: 150px;">Estudiante / Asignación</th>
            `;

            rubros.forEach(r => {
                // <wbr> permite partir "Asistencia/Participación" en dos renglones
                // en vez de ensanchar la columna.
                html += `<th style="${celdaBase} white-space: normal; min-width: 72px;">${r.label.replace('/', '/<wbr>')}<br><span style="font-size:10px; font-weight:normal;">(${Math.round(r.peso * 100)}%)</span></th>`;
            });

            html += `
                            <th style="${celdaBase} white-space: normal; min-width: 58px;">Nota Final</th>
                            <th style="${celdaBase}${llevaComentario ? ' width: 100%; min-width: 260px;' : ''}">Reflexiones Docentes</th>
                            <th style="${celdaBase} width: 1%; min-width: 150px;">Acción</th>
                        </tr>
                    </thead>
                    <tbody>
            `;

            estudiantes.forEach(est => {
                const notasEst = notasPorEstudiante.get(String(est.cedula)) || [];
                const resActual = resolverNota(notasEst, materia, periodo);
                const resOtro = resolverNota(notasEst, materia, periodoOtro);
                // Solo se precargan las casillas con un registro del AÑO ACTIVO: un
                // registro de otro año se muestra como aviso, nunca dentro de las
                // casillas (para que no se vuelva a guardar por error como dato nuevo).
                const notaReg = (resActual && !resActual.otroAnio) ? resActual.fila : null;
                const promedioGuardado = notaReg ? notaReg.promedio : '-';
                const comentarioGuardado = notaReg && notaReg.comentario ? notaReg.comentario : '';
                // Evidencia de cómo se calificó cada componente la última vez
                // (queda guardada en notas.detalle_componentes como JSON).
                let detalleGuardado = (notaReg && notaReg.detalle_componentes) ? notaReg.detalle_componentes : {};
                if (typeof detalleGuardado === 'string') { try { detalleGuardado = JSON.parse(detalleGuardado); } catch (_) { detalleGuardado = {}; } }
                // Artes Plásticas pasó de (Asistencia 25 / Cotidiano 60 / Autorregulación 15)
                // a (Asistencia 25 / Trabajo en clase 75). Para registros ya guardados con
                // los rubros viejos, "Trabajo en clase" se precarga con el equivalente de
                // Cotidiano + Autorregulación, así el docente no tiene que volver a calificar.
                if (materia.includes('Artes Plásticas') && !detalleGuardado.trabajo_clase && detalleGuardado.cotidiano && !isNaN(Number(detalleGuardado.cotidiano.valor))) {
                    const cot = Number(detalleGuardado.cotidiano.valor);
                    const aut = (detalleGuardado.autorregulacion && !isNaN(Number(detalleGuardado.autorregulacion.valor))) ? Number(detalleGuardado.autorregulacion.valor) : null;
                    const trabajo = aut !== null ? (cot * 0.60 + aut * 0.15) / 0.75 : cot;
                    detalleGuardado = { ...detalleGuardado, trabajo_clase: { label: 'Trabajo en clase', peso: 0.75, valor: Number(trabajo.toFixed(2)) } };
                }

                html += `
                    <tr>
                        <td style="${celdaBase} text-align: left; white-space: normal; min-width: 150px; max-width: 220px;"><b>${escapeHTML(est.nombre)}</b><br><small>Inst. Princ: ${escapeHTML(est.instrumento_principal) || 'N/A'} | Inst. 2do: ${escapeHTML(est.instrumento_segundo) || 'Ninguno'}</small></td>
                `;

                rubros.forEach(r => {
                    // data-rubro-id identifica el componente, y "value" recupera
                    // la nota de ese componente guardada la última vez, para que
                    // el docente vea SIEMPRE lo que ya calificó, no una casilla vacía.
                    // detalleGuardado[r.id] es un objeto { label, peso, valor } —
                    // hay que sacar solo el número (.valor) para meterlo en el
                    // input; si se deja el objeto completo, el navegador lo
                    // convierte en el texto "[object Object]" y lo rechaza
                    // (ese era el error "cannot be parsed" de la consola).
                    const rubroPrevio = detalleGuardado[r.id];
                    const valorPrevio = (rubroPrevio && rubroPrevio.valor !== undefined && rubroPrevio.valor !== null) ? rubroPrevio.valor : '';
                    html += `<td style="${celdaBase}"><input type="number" step="0.01" min="0" max="100" class="input-rubro-${est.cedula}" data-rubro-id="${r.id}" data-rubro-label="${escapeHTML(r.label)}" data-peso="${r.peso}" value="${valorPrevio}" placeholder="0-100" style="width: 64px; padding: 8px 4px; text-align: center;" oninput="calcularNotaFinalEstudiante('${est.cedula}'); programarGuardadoAutomatico('${est.cedula}', '${materia}', '${periodo}', ${esConducta})"></td>`;
                });

                html += `
                        <td style="${celdaBase}"><b id="lbl-final-${est.cedula}" style="color: var(--accent); font-size: 13px;">${promedioGuardado}</b></td>
                        <td style="${celdaBase} text-align: left;${llevaComentario ? '' : ' min-width: 180px; max-width: 320px; white-space: normal;'}">
                `;

                if (llevaComentario) {
                    html += `<textarea class="reflexion-input" id="comentario-est-${est.cedula}" rows="2" placeholder="${esConducta ? 'Reflexión docente obligatoria...' : 'Reflexión docente opcional...'}" style="width: 100%; min-width: 240px; min-height: 52px; resize: vertical; overflow: hidden; line-height: 1.35; font-family: inherit; font-size: 13px; white-space: pre-wrap;" ${esConducta ? 'required' : ''} oninput="ajustarAltoTextarea(this); programarGuardadoAutomatico('${est.cedula}', '${materia}', '${periodo}', ${esConducta})">${escapeHTML(comentarioGuardado)}</textarea>`;
                } else {
                    html += `<span style="color: #94a3b8; font-size: 11px; font-style: italic;">No requerido</span>`;
                }
                // Vista integrada: el OTRO período (nota, reflexión y docente) queda a la
                // vista en la misma fila, y los registros irregulares se avisan.
                html += htmlBloqueOtroPeriodo(est, materia, periodoOtro, resOtro);
                if (resActual && resActual.otroAnio) html += htmlAvisoOtroAnio(resActual);
                else if (resActual && resActual.materiaAntigua) html += htmlAvisoMateriaAntigua();

                // Etiqueta de auditoría precargada con lo último guardado en
                // Supabase (si existe), para que se vea "de entrada" quién
                // hizo el último cambio sin tener que volver a guardar.
                let auditStr = '';
                if (notaReg && notaReg.modificado_por && notaReg.modificado_en) {
                    auditStr = htmlAuditoria(notaReg.modificado_por, notaReg.modificado_en);
                }

                html += `
                        </td>
                        <td style="${celdaBase} vertical-align: top;">
                            <button class="action-btn" style="padding: 6px 12px; font-size: 12px;" onclick="guardarNotaComponentes('${est.cedula}', '${materia}', '${periodo}', ${esConducta})">Guardar</button>
                            <div id="save-status-${est.cedula}" style="font-size: 11px; margin-top: 4px; color: #64748b; white-space: normal; max-width: 150px; margin-left: auto; margin-right: auto; overflow-wrap: anywhere;"></div>
                            <div id="audit-${est.cedula}" style="font-size: 10px; margin-top: 3px; color: #94a3b8; font-style: italic; line-height: 1.25; white-space: normal; max-width: 150px; margin-left: auto; margin-right: auto; overflow-wrap: anywhere;">${auditStr}</div>
                        </td>
                    </tr>
                `;
            });

            html += `</tbody></table></div>`;
            contenedor.innerHTML = html;
            // Ajusta cada caja de reflexión a su contenido para que el comentario
            // se vea completo (ya con el HTML en pantalla, que es cuando se puede
            // medir el alto real del texto).
            contenedor.querySelectorAll('textarea.reflexion-input').forEach(ajustarAltoTextarea);
        }

        function calcularNotaFinalEstudiante(cedula) {
            const inputs = document.querySelectorAll(`.input-rubro-${cedula}`);
            let total = 0;
            let hayFueraDeRango = false;

            inputs.forEach(input => {
                const val = parseFloat(input.value);
                const peso = parseFloat(input.getAttribute('data-peso'));

                // Bloquea notas por componente fuera de 0-100 (ej. escribir
                // "1000" en vez de "100" por error). El min/max del HTML es
                // solo visual y no impide escribir el valor, así que aquí se
                // valida de verdad: se resalta en rojo y NO se deja calcular
                // ni guardar la nota final hasta corregirlo.
                if (!isNaN(val) && (val < 0 || val > 100)) {
                    hayFueraDeRango = true;
                    input.style.border = '2px solid #dc2626';
                    input.title = 'La nota debe estar entre 0 y 100';
                } else {
                    input.style.border = '';
                    input.title = '';
                }

                if (!isNaN(val)) {
                    total += val * peso;
                }
            });

            const lblFinal = document.getElementById(`lbl-final-${cedula}`);
            if (lblFinal) {
                if (hayFueraDeRango) {
                    lblFinal.innerText = '⚠ Fuera de rango';
                    lblFinal.style.color = '#dc2626';
                } else {
                    lblFinal.innerText = Number(total.toFixed(2));
                    lblFinal.style.color = 'var(--accent)';
                }
            }

            return !hayFueraDeRango;
        }

        // ============================================================
        // GUARDADO AUTOMÁTICO de la planilla de Calificar.
        // Se dispara solo (con "debounce" de 1.2s tras dejar de escribir)
        // cada vez que el docente cambia un rubro o la reflexión, así no
        // depende de acordarse de pulsar "Guardar". El botón "Guardar"
        // sigue funcionando igual, por si alguien quiere forzar el guardado
        // al instante. En modo automático NUNCA se usa alert() (interrumpiría
        // al docente mientras escribe): el estado se muestra en un textito
        // discreto bajo el botón de cada estudiante.
        // ============================================================
        const timersGuardadoAutomatico = {};

        function programarGuardadoAutomatico(cedula, materia, periodo, esConducta) {
            const status = document.getElementById(`save-status-${cedula}`);
            if (status) { status.style.color = '#d97706'; status.innerText = 'Escribiendo…'; }

            if (timersGuardadoAutomatico[cedula]) clearTimeout(timersGuardadoAutomatico[cedula]);
            timersGuardadoAutomatico[cedula] = setTimeout(() => {
                guardarNotaComponentes(cedula, materia, periodo, esConducta, true);
            }, 1200);
        }

        async function guardarNotaComponentes(cedula, materia, periodo, esConducta, silencioso) {
            const status = document.getElementById(`save-status-${cedula}`);
            const marcarEstado = (texto, color) => {
                if (silencioso && status) { status.style.color = color; status.innerText = texto; }
                else if (!silencioso) alert(texto);
            };

            // Revalida (y vuelve a marcar en rojo si hace falta) justo antes
            // de guardar, sin depender de que el último "oninput" se haya
            // disparado a tiempo — así nunca se guarda una nota con un
            // componente fuera de 0-100.
            const rangoValido = calcularNotaFinalEstudiante(cedula);
            if (!rangoValido) {
                marcarEstado('⚠ Hay una nota fuera de 0-100. Corríjala antes de guardar.', '#dc2626');
                return;
            }

            let promedioFinal = NaN;
            const comentarioInput = document.getElementById(`comentario-est-${cedula}`);
            const comentario = comentarioInput ? comentarioInput.value.trim() : '';

            // Evidencia de cómo calificó el docente: se guarda la nota de
            // CADA componente (no solo el promedio final), con su etiqueta
            // y peso tal como se usaron en ese momento, para que quede
            // registro permanente del detalle aunque después cambien los
            // componentes de esa materia.
            const detalleComponentes = {};
            document.querySelectorAll(`.input-rubro-${cedula}`).forEach(input => {
                const idRubro = input.getAttribute('data-rubro-id');
                const valor = parseFloat(input.value);
                if (idRubro && !isNaN(valor)) {
                    detalleComponentes[idRubro] = {
                        label: input.getAttribute('data-rubro-label') || idRubro,
                        peso: parseFloat(input.getAttribute('data-peso')),
                        valor: valor
                    };
                }
            });

            // El promedio se calcula directamente de las notas escritas (no se lee del
            // texto en pantalla). Si todavía no hay NINGÚN componente con nota, no se
            // guarda nada: antes, escribir solo la reflexión guardaba un 0 por error.
            const idsConNota = Object.keys(detalleComponentes);
            if (idsConNota.length > 0) {
                promedioFinal = Number(idsConNota.reduce((acc, id) => acc + detalleComponentes[id].valor * detalleComponentes[id].peso, 0).toFixed(2));
            }

            if (isNaN(promedioFinal)) {
                // En modo automático simplemente esperamos (el docente sigue
                // llenando componentes); en modo manual sí avisamos.
                if (!silencioso) alert('Por favor ingrese las notas en los componentes antes de guardar.');
                else if (status) { status.style.color = '#94a3b8'; status.innerText = ''; }
                return;
            }

            if (esConducta && !comentario) {
                marcarEstado('⚠ Falta la reflexión docente (obligatoria en Conducta).', '#b45309');
                if (!silencioso && comentarioInput) comentarioInput.focus();
                return;
            }

            const datos = { 
                cedula_estudiante: String(cedula), 
                materia: String(materia), 
                periodo: String(periodo), 
                anio_lectivo: anioLectivoActivo,
                promedio: Number(promedioFinal),
                comentario: String(comentario),
                detalle_componentes: detalleComponentes,
                // Rastro de auditoría: quién hizo el último cambio y cuándo.
                // Se sobrescribe en cada guardado con el usuario/fecha/hora
                // ACTUAL, por diseño: siempre refleja la última mano que tocó
                // ese registro (no un historial completo de cada cambio).
                modificado_por: usuarioEmailGlobal || 'desconocido',
                modificado_en: new Date().toISOString()
            };

            try {
                const { error } = await supabaseClient.from('notas').upsert([datos], { onConflict: 'cedula_estudiante,materia,periodo,anio_lectivo' });
                if (error) {
                    marcarEstado('Error al guardar: ' + error.message, '#dc2626');
                } else {
                    const cuando = new Date().toLocaleTimeString('es-CR', { hour: '2-digit', minute: '2-digit' });
                    marcarEstado(silencioso ? `✓ Guardado automáticamente (${cuando})` : `¡Calificación guardada con éxito para la cédula ${cedula} (Año lectivo ${anioLectivoActivo})!`, '#166534');
                    actualizarEtiquetaAuditoria(cedula, datos.modificado_por, datos.modificado_en);
                }
            } catch (e) {
                // Captura fallos de RED (sin internet, CORS, etc.), que NO
                // llegan como "error" de Supabase sino como excepción — sin
                // este try/catch, un corte de internet a mitad de la
                // calificación rompía la ejecución silenciosamente.
                marcarEstado('Sin conexión: no se pudo guardar. Se reintentará al escribir de nuevo.', '#dc2626');
            }
        }

        // Texto de auditoría ("quién / qué día / a qué hora" fue el último
        // guardado), en 3 renglones apilados para caber en la columna
        // angosta de "Acción". Se usa tanto al abrir la planilla como justo
        // después de guardar, para que se vea siempre igual.
        function htmlAuditoria(correo, fechaISO) {
            const fecha = new Date(fechaISO);
            const fechaStr = fecha.toLocaleDateString('es-CR', { day: '2-digit', month: '2-digit', year: 'numeric' });
            const horaStr = fecha.toLocaleTimeString('es-CR', { hour: '2-digit', minute: '2-digit' });
            return `Últ. cambio:<br>${escapeHTML(correo)}<br>${fechaStr} ${horaStr}`;
        }

        // Muestra "quién / qué día / a qué hora" quedó el último guardado,
        // justo debajo del botón Guardar de cada estudiante — la evidencia
        // de auditoría que pidió la institución para legalizar el registro.
        function actualizarEtiquetaAuditoria(cedula, correo, fechaISO) {
            const el = document.getElementById(`audit-${cedula}`);
            if (!el) return;
            el.innerHTML = htmlAuditoria(correo, fechaISO);
        }

        // Hace que la caja de la reflexión crezca (o se encoja) según su texto,
        // así el comentario se ve completo en la misma vista, partido en los
        // renglones que haga falta, sin barra de desplazamiento interna.
        function ajustarAltoTextarea(el) {
            if (!el) return;
            el.style.height = 'auto';
            el.style.height = (el.scrollHeight + 2) + 'px';
        }

        // Si cambia el ancho de la ventana (girar el celular, redimensionar),
        // el texto se parte distinto: se vuelve a medir cada caja.
        (function () {
            let t = null;
            window.addEventListener('resize', () => {
                clearTimeout(t);
                t = setTimeout(() => {
                    document.querySelectorAll('textarea.reflexion-input').forEach(ajustarAltoTextarea);
                }, 150);
            });
        })();

        // =====================================================================
        // IMPORTACIÓN DE NOTAS DESDE EXCEL
        // =====================================================================

        // Nombre de materia tal como aparece en el Excel (en minúsculas, sin
        // tildes ambiguas) -> valor exacto de materia usado por la app.
        const MAPEO_MATERIA_EXCEL = {
            'español': '[Académica] Español',
            'matemáticas': '[Académica] Matemáticas',
            'matematicas': '[Académica] Matemáticas',
            'ciencias': '[Académica] Ciencias',
            'estudios sociales': '[Académica] Estudios Sociales',
            'inglés': '[Académica] Inglés',
            'ingles': '[Académica] Inglés',
            'conducta': '[Académica] Conducta',
            'arte': '[Artística] Artes Plásticas',
            'artes plásticas': '[Artística] Artes Plásticas',
            'artes plasticas': '[Artística] Artes Plásticas',
            'danza': '[Artística] Danza',
            'guitarra': '[Artística] Guitarra',
            'piano': '[Artística] Piano',
            'ukelele': '[Artística] Ukulele',
            'ukulele': '[Artística] Ukulele',
            'canto': '[Artística] Canto',
            'percusión': '[Artística] Batería',
            'percusion': '[Artística] Batería',
            'bajo': '[Artística] Bajo',
            'solfeo': '[Artística] Solfeo',
            'taller de percusión': '[Artística] Taller de Percusión',
            'taller de percusion': '[Artística] Taller de Percusión',
            'educación física': '[Artística] Edufi',
            'educacion fisica': '[Artística] Edufi',
            'edufi': '[Artística] Edufi'
        };

        // Instrumentos individuales: si el Excel trae la casilla en 0 y sin
        // comentario, se asume que ese estudiante NO lleva ese instrumento
        // (el Excel suele traer todas las columnas de instrumentos para
        // todos los estudiantes, en 0 cuando no aplica) y no se importa.
        const MATERIAS_OPCIONALES_SI_CERO = ['Piano', 'Guitarra', 'Ukulele', 'Canto', 'Bajo', 'Batería'];

        let workbookImportadoGlobal = null;
        let datosParaImportar = [];

        function procesarArchivoExcelImport(evt) {
            const archivo = evt.target.files[0];
            const contenedorPreview = document.getElementById('contenedor-preview-import');
            const selectHoja = document.getElementById('import-hoja-select');
            document.getElementById('fieldset-confirmar-import').style.display = 'none';

            if (!archivo) return;

            contenedorPreview.innerHTML = '<p>Leyendo archivo...</p>';
            const lector = new FileReader();
            lector.onload = function(e) {
                try {
                    const datosBin = new Uint8Array(e.target.result);
                    workbookImportadoGlobal = XLSX.read(datosBin, { type: 'array' });

                    selectHoja.innerHTML = '';
                    let hojaCedulaDetectada = '';
                    workbookImportadoGlobal.SheetNames.forEach(nombreHoja => {
                        const opt = document.createElement('option');
                        opt.value = nombreHoja;
                        opt.textContent = nombreHoja;
                        selectHoja.appendChild(opt);

                        if (!hojaCedulaDetectada) {
                            const hojaTmp = XLSX.utils.sheet_to_json(workbookImportadoGlobal.Sheets[nombreHoja], { header: 1, defval: '' });
                            for (let r = 0; r < Math.min(hojaTmp.length, 15); r++) {
                                if ((hojaTmp[r] || []).some(v => String(v).trim().toLowerCase() === 'cédula' || String(v).trim().toLowerCase() === 'cedula')) {
                                    hojaCedulaDetectada = nombreHoja;
                                    break;
                                }
                            }
                        }
                    });

                    if (hojaCedulaDetectada) selectHoja.value = hojaCedulaDetectada;
                    previsualizarImportacionExcel();
                } catch (err) {
                    contenedorPreview.innerHTML = '<p style="color: red;">Error al leer el archivo: ' + err.message + '</p>';
                }
            };
            lector.readAsArrayBuffer(archivo);
        }

        function detectarEncabezadosHojaImport(filas) {
            let filaCedula = -1, colCedula = -1, colNombre = -1, colNivel = -1;

            for (let r = 0; r < Math.min(filas.length, 15); r++) {
                const fila = filas[r] || [];
                for (let c = 0; c < fila.length; c++) {
                    const v = String(fila[c] || '').trim().toLowerCase();
                    if (v === 'cédula' || v === 'cedula') { filaCedula = r; colCedula = c; }
                }
            }
            if (filaCedula === -1) return null;

            const filaHeader = filas[filaCedula] || [];
            const filaGrupo = filas[filaCedula - 1] || [];

            filaHeader.forEach((val, c) => {
                const v = String(val || '').trim().toLowerCase();
                if (v === 'nombre') colNombre = c;
                if (v === 'nivel') colNivel = c;
            });

            let inicios = [];
            filaGrupo.forEach((val, c) => {
                if (val && String(val).trim() !== '') inicios.push({ col: c, nombre: String(val).trim() });
            });

            let bloques = [];
            inicios.forEach((ini, idx) => {
                const colFin = idx + 1 < inicios.length ? inicios[idx + 1].col : filaHeader.length;
                let colPromedio = -1, colComentario = -1;
                for (let c = ini.col; c < colFin; c++) {
                    const v = String(filaHeader[c] || '').trim().toLowerCase();
                    if (v === 'promedio') colPromedio = c;
                    if (v === 'comentario') colComentario = c;
                }
                if (colPromedio !== -1) {
                    bloques.push({ materiaExcel: ini.nombre, colPromedio, colComentario });
                }
            });

            return { filaDatosInicio: filaCedula + 1, colCedula, colNombre, colNivel, bloques };
        }

        async function previsualizarImportacionExcel() {
            const contenedorPreview = document.getElementById('contenedor-preview-import');
            document.getElementById('fieldset-confirmar-import').style.display = 'none';

            const nombreHoja = document.getElementById('import-hoja-select').value;
            if (!workbookImportadoGlobal || !nombreHoja) return;

            contenedorPreview.innerHTML = '<p>Procesando hoja seleccionada...</p>';

            const filas = XLSX.utils.sheet_to_json(workbookImportadoGlobal.Sheets[nombreHoja], { header: 1, defval: '' });
            const estructura = detectarEncabezadosHojaImport(filas);

            if (!estructura) {
                contenedorPreview.innerHTML = '<p style="color: red;">No se encontró una columna "Cédula" en esta hoja. Seleccione otra hoja.</p>';
                return;
            }

            const { data: estudiantesBD } = await supabaseClient.from('estudiantes').select('cedula, nombre, activo');
            const mapaEstudiantes = new Map();
            (estudiantesBD || []).forEach(e => mapaEstudiantes.set(String(e.cedula).trim(), e));

            const materiasNoReconocidas = new Set();
            datosParaImportar = [];

            for (let r = estructura.filaDatosInicio; r < filas.length; r++) {
                const fila = filas[r] || [];
                const cedulaRaw = fila[estructura.colCedula];
                if (cedulaRaw === '' || cedulaRaw === null || cedulaRaw === undefined) continue;

                const cedula = String(cedulaRaw).trim().replace(/\.0$/, '');
                if (!/^[0-9]+$/.test(cedula)) continue;

                const nombreExcel = estructura.colNombre !== -1 ? String(fila[estructura.colNombre] || '').trim() : '';
                const estBD = mapaEstudiantes.get(cedula);

                let materiasFila = [];
                estructura.bloques.forEach(bloque => {
                    const claveMapeo = bloque.materiaExcel.trim().toLowerCase();
                    const materiaApp = MAPEO_MATERIA_EXCEL[claveMapeo];
                    if (!materiaApp) {
                        materiasNoReconocidas.add(bloque.materiaExcel);
                        return;
                    }

                    const promedioRaw = fila[bloque.colPromedio];
                    const promedio = (promedioRaw === '' || promedioRaw === null || promedioRaw === undefined) ? null : parseFloat(promedioRaw);
                    const comentario = bloque.colComentario !== -1 ? String(fila[bloque.colComentario] || '').trim() : '';

                    if (promedio === null || isNaN(promedio)) return;

                    const nombreMateriaLimpia = nombreMateriaLimpio(materiaApp);
                    if (MATERIAS_OPCIONALES_SI_CERO.includes(nombreMateriaLimpia) && promedio === 0 && !comentario) {
                        return; // Instrumento no cursado por este estudiante, se omite.
                    }

                    materiasFila.push({ materia: materiaApp, promedio, comentario });
                });

                if (materiasFila.length === 0) continue;

                datosParaImportar.push({
                    cedula,
                    nombreExcel,
                    encontrado: !!estBD,
                    activo: estBD ? estBD.activo !== false : null,
                    materias: materiasFila
                });
            }

            renderizarPreviewImportacion(materiasNoReconocidas);
        }

        function renderizarPreviewImportacion(materiasNoReconocidas) {
            const contenedorPreview = document.getElementById('contenedor-preview-import');
            const periodo = document.getElementById('import-periodo-select').value;

            if (datosParaImportar.length === 0) {
                contenedorPreview.innerHTML = '<p style="color: #64748b;">No se encontraron filas de estudiantes con datos de notas en esta hoja.</p>';
                return;
            }

            const totalOk = datosParaImportar.filter(d => d.encontrado).length;
            const totalNoEncontrados = datosParaImportar.filter(d => !d.encontrado).length;
            const totalNotas = datosParaImportar.reduce((acc, d) => acc + d.materias.length, 0);

            let html = `
                <p><b>Periodo destino:</b> ${periodo} — <b>Año Lectivo Activo:</b> ${anioLectivoActivo}</p>
                <p style="color: #166534;"><b>${totalOk}</b> estudiantes encontrados en la matrícula — <b>${totalNotas}</b> notas listas para importar.</p>
                ${totalNoEncontrados > 0 ? `<p style="color: #991b1b;"><b>${totalNoEncontrados}</b> cédulas del Excel NO coinciden con ningún estudiante matriculado y NO se importarán. Revíselas abajo.</p>` : ''}
                ${materiasNoReconocidas.size > 0 ? `<p style="color: #92400e;"><b>Materias del Excel no reconocidas (se ignoraron):</b> ${escapeHTML(Array.from(materiasNoReconocidas).join(', '))}</p>` : ''}
                <table class="data-table">
                    <thead><tr><th>Cédula</th><th style="text-align:left;">Nombre (Excel)</th><th>Estado</th><th>Materias a importar</th></tr></thead>
                    <tbody>
            `;

            datosParaImportar.forEach(d => {
                const estadoTxt = !d.encontrado ? '<span style="color:#991b1b;">NO ENCONTRADO</span>' : (d.activo ? '<span style="color:#166534;">OK</span>' : '<span style="color:#92400e;">OCULTO</span>');
                html += `<tr><td>${escapeHTML(d.cedula)}</td><td style="text-align:left;">${escapeHTML(d.nombreExcel)}</td><td>${estadoTxt}</td><td style="text-align:left; font-size:12px;">${d.materias.map(m => nombreMateriaLimpio(m.materia)).join(', ')}</td></tr>`;
            });

            html += '</tbody></table>';
            contenedorPreview.innerHTML = html;

            if (totalOk > 0) {
                document.getElementById('fieldset-confirmar-import').style.display = 'block';
            }
        }

        async function ejecutarImportacionExcel() {
            const periodo = document.getElementById('import-periodo-select').value;
            const msgSpan = document.getElementById('import-progreso-msg');

            const filasValidas = datosParaImportar.filter(d => d.encontrado);
            if (filasValidas.length === 0) {
                alert('No hay estudiantes válidos para importar.');
                return;
            }

            if (!confirm(`¿Importar ${filasValidas.reduce((a, d) => a + d.materias.length, 0)} notas para ${filasValidas.length} estudiantes en el ${periodo} del Año Lectivo ${anioLectivoActivo}? Si una materia ya tenía nota guardada para ese estudiante/periodo/año, será REEMPLAZADA por la del Excel.`)) {
                return;
            }

            msgSpan.style.color = '#166534';
            msgSpan.innerText = 'Importando... no cierre esta pestaña.';

            let registros = [];
            filasValidas.forEach(d => {
                d.materias.forEach(m => {
                    registros.push({
                        cedula_estudiante: d.cedula,
                        materia: m.materia,
                        periodo: periodo,
                        anio_lectivo: anioLectivoActivo,
                        promedio: m.promedio,
                        comentario: m.comentario,
                        // El detalle por componente de una nota importada no existe: se limpia para que
                        // la planilla no muestre componentes viejos que ya no suman ese promedio.
                        detalle_componentes: {},
                        modificado_por: (usuarioEmailGlobal || 'desconocido') + ' (importación Excel)',
                        modificado_en: new Date().toISOString()
                    });
                });
            });

            let importadas = 0;
            const tamanoLote = 200;
            for (let i = 0; i < registros.length; i += tamanoLote) {
                const lote = registros.slice(i, i + tamanoLote);
                const { error } = await supabaseClient.from('notas').upsert(lote, { onConflict: 'cedula_estudiante,materia,periodo,anio_lectivo' });
                if (error) {
                    msgSpan.style.color = '#991b1b';
                    msgSpan.innerText = `Error al importar el lote ${i / tamanoLote + 1}: ${error.message}`;
                    return;
                }
                importadas += lote.length;
                msgSpan.innerText = `Importando... ${importadas} de ${registros.length} notas.`;
            }

            msgSpan.style.color = '#166534';
            msgSpan.innerText = `¡Listo! Se importaron ${importadas} notas para ${filasValidas.length} estudiantes en el ${periodo} del Año Lectivo ${anioLectivoActivo}.`;
        }

        async function cargarCuadrosRegistro() {
            const nivel = document.getElementById('reg-nivel-sel').value;
            const anio = parseInt(document.getElementById('reg-anio-sel').value, 10) || anioLectivoActivo;
            const contenedor = document.getElementById('contenedor-cuadros-registro');

            if (!nivel) {
                contenedor.innerHTML = '<p style="color: #64748b;">Seleccione un año y un nivel educativo para desplegar el registro histórico.</p>';
                return;
            }

            contenedor.innerHTML = '<p>Cargando registro histórico institucional...</p>';

            const { data: estudiantes, error: errEst } = await supabaseClient.from('estudiantes').select('*').eq('nivel', nivel).eq('activo', true);
            if (errEst) {
                contenedor.innerHTML = '<p style="color: red;">Error al cargar estudiantes: ' + escapeHTML(errEst.message) + '</p>';
                return;
            }
            if (!estudiantes || estudiantes.length === 0) {
                contenedor.innerHTML = `<p>No hay estudiantes matriculados en ${escapeHTML(nivel)}.</p>`;
                return;
            }

            const { data: notas, error: errNotas } = await supabaseClient.from('notas').select('*').eq('anio_lectivo', anio).in('cedula_estudiante', estudiantes.map(e => e.cedula));
            if (errNotas) {
                contenedor.innerHTML = '<p style="color: red;">Error al cargar las notas: ' + escapeHTML(errNotas.message) + '</p>';
                return;
            }
            const notasPorEstudiante = agruparNotasPorEstudiante(notas);

            // Materias del nivel (sin repetir por variantes de escritura), en orden institucional.
            const mapaMaterias = new Map();
            estudiantes.forEach(est => {
                materiasUnicasConNota(notasPorEstudiante.get(String(est.cedula)), est).forEach(v => {
                    const k = claveMateria(v);
                    if (!mapaMaterias.has(k)) mapaMaterias.set(k, v);
                });
            });
            const listaMaterias = [...mapaMaterias.values()].sort((a, b) => posicionMateria(a) - posicionMateria(b));

            let html = `<h3>Registro Histórico - Nivel: ${escapeHTML(nivel)} - Año Lectivo: ${anio}</h3>`;
            html += `<table class="data-table"><thead><tr><th>Estudiante</th><th>Cédula</th><th>Profesores / Inst</th>`;

            if (listaMaterias.length === 0) {
                html += `<th>Sin materias registradas aún</th></tr></thead><tbody>`;
            } else {
                listaMaterias.forEach(mat => {
                    html += `<th>${escapeHTML(nombreLimpioMateria(mat))}<br><span style="font-size:10px; font-weight:normal;">1°P | 2°P | Final (50%-50%)</span></th>`;
                });
                html += `</tr></thead><tbody>`;
            }

            estudiantes.forEach(est => {
                const notasEst = notasPorEstudiante.get(String(est.cedula)) || [];
                html += `<tr><td><b>${escapeHTML(est.nombre)}</b></td><td>${escapeHTML(est.cedula)}</td><td><small>Acad: ${escapeHTML(est.docente_academico) || 'N/A'}<br>Solfeo: ${escapeHTML(est.docente_solfeo) || 'N/A'}<br>Percusión: ${escapeHTML(est.docente_percursion) || 'N/A'}<br>Inst: ${escapeHTML(est.instrumento_principal) || 'N/A'}</small></td>`;

                listaMaterias.forEach(mat => {
                    const r1 = resolverNota(notasEst, mat, 'Primer Periodo', anio);
                    const r2 = resolverNota(notasEst, mat, 'Segundo Periodo', anio);
                    const v1 = promedioNumerico(r1 ? r1.fila : null);
                    const v2 = promedioNumerico(r2 ? r2.fila : null);
                    const finalStr = (v1 !== null && v2 !== null) ? Number(((v1 * 0.5) + (v2 * 0.5)).toFixed(2)) : '-';
                    html += `<td>1°P: ${v1 !== null ? v1 : '-'}<br>2°P: ${v2 !== null ? v2 : '-'}<br><b>Final: ${finalStr}</b></td>`;
                });
                html += `</tr>`;
            });

            html += `</tbody></table>`;
            contenedor.innerHTML = html;
        }

        async function cargarEstudiantesInforme() {
            const nivel = document.getElementById('inf-nivel-sel').value;
            const selectEstudiantes = document.getElementById('inf-estudiante-sel');
            selectEstudiantes.innerHTML = '<option value="">Cargando lista...</option>';

            if (!nivel) {
                selectEstudiantes.innerHTML = '<option value="">Primero seleccione un nivel</option>';
                return;
            }

            const { data, error } = await supabaseClient.from('estudiantes').select('*').eq('nivel', nivel).eq('activo', true);
            if (error || !data || data.length === 0) {
                selectEstudiantes.innerHTML = '<option value="">No hay estudiantes en este nivel</option>';
                return;
            }

            selectEstudiantes.innerHTML = '<option value="">Seleccione un estudiante</option>';
            data.forEach(est => {
                const opt = document.createElement('option');
                opt.value = est.cedula;
                opt.textContent = `${est.nombre} (Cédula: ${est.cedula})`;
                opt.dataset.estudiante = JSON.stringify(est);
                selectEstudiantes.appendChild(opt);
            });
        }

        async function generarInformeHogarVisual() {
            const selectEst = document.getElementById('inf-estudiante-sel');
            const periodoSel = document.getElementById('inf-periodo-sel').value;
            const contenedor = document.getElementById('contenedor-vista-informe');
            
            if (!selectEst.value) {
                contenedor.innerHTML = '<p style="color: #64748b; text-align: center;">Seleccione el periodo y estudiante para visualizar el informe institucional al hogar.</p>';
                return;
            }

            const estData = JSON.parse(selectEst.options[selectEst.selectedIndex].dataset.estudiante);
            await logoEncabezadoListo;

            const { data: notas } = await supabaseClient.from('notas').select('*').eq('cedula_estudiante', estData.cedula);

            let tablaMateriasHTML = '';
            let reflexionesDocentesHTML = '';
            let materiasUnicas = notas ? [...new Set(notas.map(n => n.materia))] : [];

            // Si el estudiante está marcado como "No lleva" alguna materia (ej.
            // Taller de Percusión), se excluye del informe por completo, incluso
            // si existe una nota histórica de antes de marcarlo así.
            materiasUnicas = materiasUnicas.filter(mat => {
                const campo = CAMPO_DOCENTE_POR_MATERIA[nombreMateriaLimpio(mat)];
                return !(campo && estData[campo] === 'No lleva');
            });

            // Orden fijo institucional: primero Materias Básicas, luego
            // Materias Especiales (con el instrumento/canto de cada estudiante
            // en su lugar, y el segundo instrumento —si tiene— al final).
            const NOMBRE_MOSTRAR_MATERIA = { 'Artes Plásticas': 'Arte', 'Edufi': 'Educación Física' };
            const nombreParaMostrar = (n) => NOMBRE_MOSTRAR_MATERIA[n] || n;

            const ordenBasicas = ['Español', 'Matemáticas', 'Ciencias', 'Estudios Sociales', 'Inglés', 'Conducta'];
            let ordenEspeciales = ['Artes Plásticas', 'Danza'];
            if (estData.instrumento_principal) ordenEspeciales.push(estData.instrumento_principal);
            ordenEspeciales.push('Solfeo', 'Edufi', 'Taller de Percusión');
            if (estData.instrumento_segundo && estData.instrumento_segundo !== 'Ninguno') ordenEspeciales.push(estData.instrumento_segundo);

            const mapaMateriaPorNombre = {};
            materiasUnicas.forEach(mat => { mapaMateriaPorNombre[claveMateria(mat)] = mat; });

            const filasBasicas = ordenBasicas.filter(n => mapaMateriaPorNombre[claveMateria(n)]).map(n => mapaMateriaPorNombre[claveMateria(n)]);
            const filasEspeciales = ordenEspeciales.filter(n => mapaMateriaPorNombre[claveMateria(n)]).map(n => mapaMateriaPorNombre[claveMateria(n)]);

            const coloresElegantes = [
                { border: '#2563eb', bg: '#eff6ff', textHeader: '#1e40af' },
                { border: '#7c3aed', bg: '#f5f3ff', textHeader: '#5b21b6' },
                { border: '#0d9488', bg: '#f0fdfa', textHeader: '#115e59' },
                { border: '#d97706', bg: '#fffbeb', textHeader: '#92400e' },
                { border: '#db2777', bg: '#fdf2f8', textHeader: '#9d174d' },
                { border: '#4f46e5', bg: '#eef2ff', textHeader: '#3730a3' }
            ];

            const construirFilaMateria = (mat, indexGlobal) => {
                // Mismo cruce que la hoja de calificar y el historial (resolverNota): prefiere
                // el año lectivo activo y tolera variantes del nombre de la materia/período.
                const resP1 = resolverNota(notas || [], mat, 'Primer Periodo');
                const resP2 = resolverNota(notas || [], mat, 'Segundo Periodo');
                const notaP1 = resP1 ? resP1.fila : null;
                const notaP2 = resP2 ? resP2.fila : null;
                // Solo cuenta como nota un promedio numérico real (una fila con reflexión pero
                // sin nota ya no rompe el cálculo del promedio anual).
                const n1 = promedioNumerico(notaP1);
                const n2 = promedioNumerico(notaP2);

                const valP1 = n1 !== null ? n1 : '-';
                const valP2 = n2 !== null ? n2 : '-';

                let valAnual = '-';
                let estado = 'Pendiente';

                if (n1 !== null && n2 !== null) {
                    valAnual = Number(((n1 * 0.5) + (n2 * 0.5)).toFixed(2));
                    if (n1 >= 65 && n2 >= 65 && valAnual >= 65) {
                        estado = 'Aprobado';
                    } else {
                        estado = 'Reprobado';
                    }
                } else if (periodoSel === 'Primer Periodo' && n1 !== null) {
                    valAnual = valP1;
                    estado = valP1 >= 65 ? 'Aprobado (Parcial)' : 'Reprobado (Parcial)';
                }

                const notaMatPeriodo = periodoSel === 'Primer Periodo' ? notaP1 : notaP2;
                const nombreMostrado = escapeHTML(nombreParaMostrar(nombreMateriaLimpio(mat)));

                tablaMateriasHTML += `
                    <tr>
                        <td><b>${nombreMostrado}</b></td>
                        <td>${valP1}</td>
                        <td>${valP2}</td>
                        <td><b>${valAnual}</b></td>
                        <td>${estado}</td>
                    </tr>
                `;

                const esAcademicaPura = mat.includes('Español') || mat.includes('Matemáticas') || mat.includes('Ciencias') || mat.includes('Estudios Sociales');
                const esSolfeoPercusion = mat.includes('Solfeo') || mat.includes('Taller de Percusión');

                if (!esAcademicaPura && !esSolfeoPercusion && notaMatPeriodo && notaMatPeriodo.comentario) {
                    // Misma regla de "docente de la materia" que usan la hoja y el historial.
                    const docenteCargo = docenteDeMateria(estData, mat) || 'No asignado';

                    const estiloColor = coloresElegantes[indexGlobal % coloresElegantes.length];

                    reflexionesDocentesHTML += `
                        <div class="reflexion-item" style="padding: 12px 15px; border-radius: 6px; border-left: 4px solid ${estiloColor.border}; border: 1px solid ${estiloColor.border}; background-color: ${estiloColor.bg}; margin-bottom: 10px;">
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px; font-size: 12px;">
                                <span style="font-weight: bold; color: ${estiloColor.textHeader}; text-transform: uppercase;">Materia: ${nombreMostrado}</span>
                                <span style="font-style: italic; color: #475569;">Docente: <b>${escapeHTML(docenteCargo)}</b></span>
                            </div>
                            <p style="margin: 0; font-size: 13px; color: #1e293b;">${escapeHTML(notaMatPeriodo.comentario)}</p>
                        </div>
                    `;
                }
            };

            if (filasBasicas.length === 0 && filasEspeciales.length === 0) {
                tablaMateriasHTML = `<tr><td colspan="5" style="text-align: center; color: #94a3b8;">No hay calificaciones registradas para este estudiante.</td></tr>`;
            } else {
                let indexGlobal = 0;
                if (filasBasicas.length > 0) {
                    tablaMateriasHTML += `<tr><td colspan="5" style="background: #e0f2fe; color: #0c4a6e; font-weight: bold; text-transform: uppercase; text-align: center; padding: 6px;">Materias Básicas</td></tr>`;
                    filasBasicas.forEach(mat => { construirFilaMateria(mat, indexGlobal); indexGlobal++; });
                }
                if (filasEspeciales.length > 0) {
                    tablaMateriasHTML += `<tr><td colspan="5" style="background: #e0f2fe; color: #0c4a6e; font-weight: bold; text-transform: uppercase; text-align: center; padding: 6px;">Materias Especiales</td></tr>`;
                    filasEspeciales.forEach(mat => { construirFilaMateria(mat, indexGlobal); indexGlobal++; });
                }
            }

            if (!reflexionesDocentesHTML) {
                reflexionesDocentesHTML = `<p style="color: #64748b; font-style: italic;">[Sin reflexiones docentes registradas para este ${periodoSel}]</p>`;
            }

            const tituloInformeHogar = periodoSel === 'Primer Periodo' 
                ? 'Primer Periodo' 
                : 'Segundo Periodo y Anual';

            // Tamaño de las firmas del pie del informe.
            // Las dos imágenes NO tienen la misma letra: medida contra la tipografía
            // del informe (Century Gothic), el nombre impreso de la firma de Jessica
            // equivale a 15,7 px a tamaño original y el de Verónica a 17,9 px. Por eso
            // dibujarlas al mismo ancho (o con el mismo %) deja letras desiguales, y
            // por eso aquí cada una lleva su propio ancho, calculado para que la
            // letra de AMBAS quede igual:
            //   - Pantalla / PDF / impresión: letra de 14 px (tabla del informe 12 px,
            //     títulos 13 px)  ->  Jessica 553 px, Verónica 579 px.
            //   - Word: letra de 15 px (el texto del Word es de 11 pt = 14,7 px)
            //     ->  Jessica 592 px, Verónica 620 px.
            // Son píxeles fijos (no %) a propósito: la letra de la tabla también es
            // de tamaño fijo, así la proporción entre ambas no cambia con el ancho
            // de la ventana.
            const esPrimerCiclo = ['Primero', 'Segundo', 'Tercero'].includes(estData.nivel);
            const FIRMA_INFORME = esPrimerCiclo
                ? { archivo: 'informe%20firma%20jessica.jpeg', ancho: 553, anchoWord: 592 }
                : { archivo: 'informe%20firma%20vero.jpeg',    ancho: 579, anchoWord: 620 };
            const imagenFirma = FIRMA_INFORME.archivo;

            // NOTA DE DISEÑO: la tabla de notas lleva display: table + width: 100% para
            // que se estire de margen a margen, alineada con el encabezado, la caja del
            // estudiante y la cita. En pantalla las tablas del sistema son display:block
            // (para poder desplazarse en celulares) y, sin esto, la de notas quedaba
            // angosta y pegada a la izquierda.
            contenedor.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; margin-top: 20px;" class="no-print">
                    <h3 style="margin: 0; color: var(--primary);">Vista Previa y Opciones de Informe al Hogar</h3>
                    <div style="display: flex; gap: 10px; flex-wrap: wrap;">
                        <button type="button" class="action-btn" onclick="window.print()">Imprimir en Físico</button>
                        <button type="button" class="warning-btn" onclick="exportarComoWord('plantilla-informe-oficial', 'Informe_${escapeHTML(estData.cedula)}')">Guardar en Word (Editable)</button>
                        <button type="button" class="success-btn" onclick="enviarInformeSimultaneo()">Enviar Informe a Encargados</button>
                    </div>
                </div>

                <div class="report-preview" id="plantilla-informe-oficial">
                    <style>
                        /* Segunda hoja (Reflexiones Docentes): ninguna línea divisoria, ni en pantalla,
                           ni al imprimir, ni en PDF, aunque la hoja de estilos de la página la defina. */
                        #plantilla-informe-oficial .salto-pagina-forzado,
                        #plantilla-informe-oficial .salto-pagina-forzado .report-header,
                        #plantilla-informe-oficial .seccion-pagina-1 {
                            border-top: 0 none !important;
                            border-bottom: 0 none !important;
                            box-shadow: none !important;
                            background-image: none !important;
                            outline: 0 none !important;
                        }
                        #plantilla-informe-oficial .salto-pagina-forzado { margin-top: 0 !important; padding-top: 0 !important; }
                        #plantilla-informe-oficial .salto-pagina-forzado::before,
                        #plantilla-informe-oficial .salto-pagina-forzado::after,
                        #plantilla-informe-oficial .salto-pagina-forzado .report-header::before,
                        #plantilla-informe-oficial .salto-pagina-forzado .report-header::after,
                        #plantilla-informe-oficial .seccion-pagina-1::after { content: none !important; display: none !important; border: 0 none !important; }
                        #plantilla-informe-oficial .salto-pagina-forzado hr { display: none !important; }
                    </style>
                    <div class="seccion-pagina-1" style="margin-bottom: 0;">
                        <div class="encabezado-informe-full" style="margin-bottom: 28px;">
                            <img src="${LOGO_ENCABEZADO_SRC}" alt="Encabezado Institucional Centro Educativo Shkénuk">
                        </div>

                        <div style="text-align: center; margin-bottom: 2px;">
                            <p style="margin: 0; font-size: 15px; color: #000000; font-weight: bold; text-transform: uppercase;">Reporte de Calificaciones ${anioLectivoActivo}</p>
                            <p style="margin: 3px 0 0 0; font-size: 12px; color: #000000; font-weight: bold; text-transform: uppercase;">Dirección Regional de Heredia - Circuito Escolar 04</p>
                            <p style="margin: 3px 0 0 0; font-size: 12px; color: #000000; font-weight: bold; text-transform: uppercase;">Centro Educativo Shkénuk</p>
                        </div>

                        <div style="margin-bottom: 6px; font-size: 12px; background: #f8fafc; padding: 6px 10px; border-radius: 6px; border: 1px solid var(--border); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                            <b>Estudiante:</b> ${escapeHTML(estData.nombre)} &nbsp;&nbsp;|&nbsp;&nbsp; <b>Cédula:</b> ${escapeHTML(estData.cedula)} &nbsp;&nbsp;|&nbsp;&nbsp; <b>Nivel:</b> ${escapeHTML(estData.nivel)}
                        </div>

                        <div style="margin-bottom: 2px;">
                            <h4 style="color: var(--primary); margin: 0 0 6px 0; font-size: 13px;">Rendimiento Académico y Artístico Consolidado — ${tituloInformeHogar}</h4>
                            <table class="data-table" style="display: table; width: 100%;">
                                <thead>
                                    <tr>
                                        <th>Materia</th>
                                        <th>1° Periodo</th>
                                        <th>2° Periodo</th>
                                        <th>Promedio Anual</th>
                                        <th>Condición</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${tablaMateriasHTML}
                                </tbody>
                            </table>
                        </div>

                        <div style="text-align: center; margin-top: 4px; page-break-inside: avoid; break-inside: avoid;">
                            <img src="${imagenFirma}" alt="Firma Autorizada" data-ancho-word="${FIRMA_INFORME.anchoWord}" style="width: ${FIRMA_INFORME.ancho}px; max-width: 100%; height: auto; display: inline-block;">
                        </div>

                        <div class="cita-montessori cita-pie-pagina">
                            <p class="texto-cita">"La primera tarea de la educación es agitar la vida, pero dejarla libre para que se desarrolle"</p>
                            <p class="autor-cita">María Montessori</p>
                        </div>
                    </div>

                    <div class="salto-pagina-forzado" style="margin: 0 !important; padding: 0 !important; border: none !important; break-before: page; page-break-before: always;">
                        <div class="report-header" style="display: flex; align-items: center; justify-content: center; border: none !important; padding: 0 !important; margin: 0 0 18px 0;">
                            <div style="text-align: center;">
                                <h3 style="margin: 0; color: var(--primary); font-size: 18px; text-transform: uppercase;">REFLEXIONES DOCENTES</h3>
                                <p style="margin: 3px 0 0 0; font-size: 13px; color: var(--accent); font-weight: bold;">${periodoSel}</p>
                            </div>
                        </div>

                        <div class="reflexiones-container">
                            ${reflexionesDocentesHTML}
                        </div>

                        <div class="cita-montessori">
                            <p class="texto-cita">"No hay nadie que lo sepa todo, ni nadie que no sepa nada. Entre todos sabemos todo"</p>
                            <p class="autor-cita">Paulo Freire</p>
                        </div>

                        <div style="text-align: center; margin-top: 12px; page-break-inside: avoid; break-inside: avoid;">
                            <img src="ces%20logo%20final%20del%20informe.jpeg" alt="Cierre CES Montessori" data-ancho-word="260" style="width: 260px; max-width: 100%; height: auto; display: inline-block;">
                        </div>
                    </div>
                </div>
            `;
        }

        function descargarInformePDF() {
            const elementoInforme = document.getElementById('plantilla-informe-oficial');
            const selectEst = document.getElementById('inf-estudiante-sel');
            const periodoSel = document.getElementById('inf-periodo-sel').value;
            const msg = document.getElementById('inf-msg');

            if (!elementoInforme || !selectEst.value) {
                alert('Por favor genere y visualice primero el informe de un estudiante antes de descargarlo.');
                return;
            }

            const estData = JSON.parse(selectEst.options[selectEst.selectedIndex].dataset.estudiante);
            const nombreArchivo = `Informe_Hogar_${estData.nombre.replace(/[^\p{L}\p{N}]+/gu, '_')}_${periodoSel.replace(/\s+/g, '_')}.pdf`;

            msg.className = 'notification success';
            msg.innerText = 'Generando archivo PDF en formato A4, por favor espere...';
            msg.style.display = 'block';

            const opciones = {
                margin:       [10, 10, 10, 10],
                filename:     nombreArchivo,
                image:        { type: 'jpeg', quality: 0.98 },
                html2canvas:  { scale: 2, useCORS: true, letterRendering: true },
                jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' }
            };

            html2pdf().from(elementoInforme).set(opciones).save().then(() => {
                msg.innerText = `¡El informe se ha descargado exitosamente como "${nombreArchivo}"!`;
                setTimeout(() => { msg.style.display = 'none'; }, 5000);
            }).catch(err => {
                msg.className = 'notification error';
                msg.innerText = 'Error al generar el PDF: ' + err;
            });
        }

        async function enviarInformeSimultaneo() {
            const selectEst = document.getElementById('inf-estudiante-sel');
            const periodoSel = document.getElementById('inf-periodo-sel').value;
            const msg = document.getElementById('inf-msg');

            if (!selectEst.value) {
                mostrarMensaje('inf-msg', 'Por favor seleccione un estudiante.', false);
                return;
            }

            const estData = JSON.parse(selectEst.options[selectEst.selectedIndex].dataset.estudiante);
            let destinatarios = [];
            if (estData.encargado1_correo) destinatarios.push(estData.encargado1_correo);
            if (estData.encargado2_correo) destinatarios.push(estData.encargado2_correo);

            if (destinatarios.length === 0) {
                mostrarMensaje('inf-msg', 'El estudiante seleccionado no tiene correos de encargados registrados en matrícula.', false);
                return;
            }

            if (EMAILJS_MODO_PRUEBA) {
                msg.className = 'notification error';
                msg.innerText = 'MODO PRUEBA: el envío real de correos todavía no está configurado (faltan las claves de EmailJS conectadas a slmontessori@gmail.com). Ningún correo fue enviado.';
                msg.style.display = 'block';
                return;
            }

            const tablaNotasEl = document.querySelector('#plantilla-informe-oficial .data-table');
            const reflexionesEl = document.querySelector('#plantilla-informe-oficial .reflexiones-container');
            const tablaNotasHTML = tablaNotasEl ? tablaNotasEl.outerHTML : '';
            const reflexionesHTML = reflexionesEl ? reflexionesEl.outerHTML : '';

            msg.className = 'notification success';
            msg.innerText = `Enviando informes de ${periodoSel} desde slmontessori@gmail.com a: ${destinatarios.join(', ')}...`;
            msg.style.display = 'block';

            try {
                const envios = destinatarios.map(correo => emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, {
                    to_email: correo,
                    nombre_estudiante: estData.nombre,
                    cedula: estData.cedula,
                    nivel: estData.nivel,
                    periodo: periodoSel,
                    anio_lectivo: anioLectivoActivo,
                    tabla_notas_html: tablaNotasHTML,
                    reflexiones_html: reflexionesHTML
                }));

                await Promise.all(envios);

                msg.className = 'notification success';
                msg.innerText = `¡Informes de ${periodoSel} enviados exitosamente y de forma simultánea a los encargados de ${estData.nombre}!`;
            } catch (err) {
                msg.className = 'notification error';
                msg.innerText = 'Error al enviar el informe: ' + (err && err.text ? err.text : (err && err.message ? err.message : err));
            }
        }

        async function cargarListasCiclo(ciclo, evt) {
            if (evt) {
                document.querySelectorAll('#listas .sub-tab-btn').forEach(el => el.classList.remove('active'));
                evt.currentTarget.classList.add('active');
            }

            const contenedor = document.getElementById('contenedor-listas-tabla');
            contenedor.innerHTML = '<p>Cargando estudiantes y calificaciones...</p>';

            let niveles = ciclo === 'Primer Ciclo' ? ['Primero', 'Segundo', 'Tercero'] : ['Cuarto', 'Quinto', 'Sexto'];
            const { data: estudiantes, error: errEst } = await supabaseClient.from('estudiantes').select('*').in('nivel', niveles).eq('activo', true);
            if (errEst) {
                contenedor.innerHTML = '<p style="color: red;">Error al cargar estudiantes: ' + escapeHTML(errEst.message) + '</p>';
                return;
            }
            if (!estudiantes || estudiantes.length === 0) {
                contenedor.innerHTML = `<p>No se encontraron estudiantes matriculados en ${escapeHTML(ciclo)}.</p>`;
                return;
            }

            const { data: notas, error: errNotas } = await supabaseClient.from('notas').select('*').eq('anio_lectivo', anioLectivoActivo).in('cedula_estudiante', estudiantes.map(e => e.cedula));
            if (errNotas) {
                contenedor.innerHTML = '<p style="color: red;">Error al cargar las notas: ' + escapeHTML(errNotas.message) + '</p>';
                return;
            }
            const notasPorEstudiante = agruparNotasPorEstudiante(notas);

            let html = `
                <h3>Listado de ${escapeHTML(ciclo)} con Instrumentos y Notas</h3>
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>Cédula</th>
                            <th>Estudiante / Profesores</th>
                            <th>Nivel</th>
                            <th>Materia</th>
                            <th>1° P</th>
                            <th>2° P</th>
                            <th>Final (50%-50%)</th>
                            <th>Estado</th>
                        </tr>
                    </thead>
                    <tbody>
            `;

            estudiantes.forEach(est => {
                const notasEst = notasPorEstudiante.get(String(est.cedula)) || [];
                const materias = materiasUnicasConNota(notasEst, est);

                if (materias.length === 0) {
                    html += `<tr><td>${escapeHTML(est.cedula)}</td><td><b>${escapeHTML(est.nombre)}</b><br><small>Acad: ${escapeHTML(est.docente_academico)}</small></td><td>${escapeHTML(est.nivel)}</td><td colspan="5" style="color: #94a3b8; text-align: center;">Sin notas registradas todavía</td></tr>`;
                } else {
                    materias.forEach((mat, idx) => {
                        const resP1 = resolverNota(notasEst, mat, 'Primer Periodo', anioLectivoActivo);
                        const resP2 = resolverNota(notasEst, mat, 'Segundo Periodo', anioLectivoActivo);
                        const p1Val = promedioNumerico(resP1 ? resP1.fila : null);
                        const p2Val = promedioNumerico(resP2 ? resP2.fila : null);

                        let notaFinalStr = '-';
                        let estado = 'Pendiente';

                        if (p1Val !== null && p2Val !== null) {
                            const finalCalc = Number(((p1Val * 0.5) + (p2Val * 0.5)).toFixed(2));
                            notaFinalStr = finalCalc;
                            if (p1Val >= 65 && p2Val >= 65 && finalCalc >= 65) {
                                estado = '<span style="color: #166534; font-weight: bold;">Aprobado (≥65)</span>';
                            } else {
                                estado = '<span style="color: #991b1b; font-weight: bold;">Reprobado (<65)</span>';
                            }
                        }

                        html += `
                            <tr>
                                ${idx === 0 ? `<td rowspan="${materias.length}">${escapeHTML(est.cedula)}</td><td rowspan="${materias.length}"><b>${escapeHTML(est.nombre)}</b><br><small>Acad: ${escapeHTML(est.docente_academico) || 'N/A'}<br>Solfeo: ${escapeHTML(est.docente_solfeo) || 'N/A'}<br>Percusión: ${escapeHTML(est.docente_percursion) || 'N/A'}<br>Inst. Princ: ${escapeHTML(est.instrumento_principal) || 'N/A'}</small></td><td rowspan="${materias.length}">${escapeHTML(est.nivel)}</td>` : ''}
                                <td>${escapeHTML(nombreLimpioMateria(mat))}</td>
                                <td>${p1Val !== null ? p1Val : '-'}</td>
                                <td>${p2Val !== null ? p2Val : '-'}</td>
                                <td><b>${notaFinalStr}</b></td>
                                <td>${estado}</td>
                            </tr>
                        `;
                    });
                }
            });

            html += `</tbody></table>`;
            contenedor.innerHTML = html;
        }

        async function procesarPromocionAutomatica() {
            const msgSpan = document.getElementById('promocion-msg') || document.getElementById('promocion-msg-matricula');

            if (usuarioRolActual !== 'admin') {
                alert('Acceso denegado: Solo los administradores pueden procesar la promoción.');
                return;
            }

            const confirmar = confirm(
                `¿Procesar la Promoción de Fin de Curso para el Año Lectivo ${anioLectivoActivo}?\n\n` +
                'Esto revisará los promedios de todos los estudiantes activos, subirá de nivel a quienes aprobaron todas las materias registradas, marcará como "Graduado" a quienes estaban en Sexto, y guardará un registro PERMANENTE de este proceso bajo este año lectivo (no se borran los años anteriores).\n\n' +
                '¿Desea continuar?'
            );
            if (!confirmar) return;

            if (msgSpan) msgSpan.innerText = 'Analizando promedios y aplicando promoción...';

            // Protección contra procesar dos veces el mismo año: si ya hay registros de
            // promoción de este año lectivo, los estudiantes ya subieron de nivel y volver
            // a correr el proceso los subiría OTRA VEZ.
            const { data: yaProcesado, error: errPrevio } = await supabaseClient.from('historial_promociones').select('cedula_estudiante').eq('anio_lectivo', anioLectivoActivo).limit(1);
            if (errPrevio) {
                const txt = 'No se pudo consultar el historial de promociones (' + errPrevio.message + '). No se realizó ningún cambio.';
                if (msgSpan) msgSpan.innerText = txt;
                alert(txt);
                return;
            }
            if (yaProcesado && yaProcesado.length > 0) {
                const txt = `La promoción del Año Lectivo ${anioLectivoActivo} ya fue procesada antes. Para evitar subir de nivel dos veces a los estudiantes, no se realizó ningún cambio.`;
                if (msgSpan) msgSpan.innerText = txt;
                alert(txt);
                return;
            }

            const { data: estudiantes, error: errEst } = await supabaseClient.from('estudiantes').select('*').eq('activo', true);
            const { data: notas, error: errNotas } = await supabaseClient.from('notas').select('*').eq('anio_lectivo', anioLectivoActivo);

            if (errEst || errNotas || !estudiantes || !notas) {
                if (msgSpan) msgSpan.innerText = 'No hay datos suficientes para procesar' + ((errEst || errNotas) ? ': ' + (errEst || errNotas).message : '.');
                return;
            }

            const notasPorEstudiante = agruparNotasPorEstudiante(notas);
            const secuenciaNiveles = { 'Primero': 'Segundo', 'Segundo': 'Tercero', 'Tercero': 'Cuarto', 'Cuarto': 'Quinto', 'Quinto': 'Sexto', 'Sexto': 'Graduado' };
            let promovidosCount = 0;
            let fallidos = 0;
            let registrosHistorial = [];

            for (const est of estudiantes) {
                const notasEst = notasPorEstudiante.get(String(est.cedula)) || [];
                // Mismas reglas que el resto del sistema: sin repetir materias por variantes
                // de escritura y sin las que el estudiante "No lleva".
                const materias = materiasUnicasConNota(notasEst, est);
                if (materias.length === 0) continue;

                let pasaTodas = true;
                for (const mat of materias) {
                    const r1 = resolverNota(notasEst, mat, 'Primer Periodo', anioLectivoActivo);
                    const r2 = resolverNota(notasEst, mat, 'Segundo Periodo', anioLectivoActivo);
                    const v1 = promedioNumerico(r1 ? r1.fila : null);
                    const v2 = promedioNumerico(r2 ? r2.fila : null);
                    if (v1 === null || v2 === null || v1 < 65 || v2 < 65) {
                        pasaTodas = false;
                        break;
                    }
                }

                if (pasaTodas && est.nivel !== 'Graduado') {
                    const nuevoNivel = secuenciaNiveles[est.nivel];
                    if (nuevoNivel) {
                        const { error: errUp } = await supabaseClient.from('estudiantes').update({ nivel: nuevoNivel }).eq('cedula', est.cedula);
                        if (errUp) {
                            // Si no se pudo subir de nivel, tampoco se anota en el historial.
                            console.error('Promoción fallida para', est.cedula, errUp);
                            fallidos++;
                            continue;
                        }
                        promovidosCount++;
                        registrosHistorial.push({
                            anio_lectivo: anioLectivoActivo,
                            cedula_estudiante: est.cedula,
                            nombre_estudiante: est.nombre,
                            nivel_origen: est.nivel,
                            nivel_destino: nuevoNivel,
                            estado: nuevoNivel === 'Graduado' ? 'Graduado' : 'Promovido'
                        });
                    }
                }
            }

            let avisoHistorial = '';
            if (registrosHistorial.length > 0) {
                const { error: errHist } = await supabaseClient.from('historial_promociones').insert(registrosHistorial);
                if (errHist) avisoHistorial = ` ATENCIÓN: los estudiantes sí subieron de nivel, pero NO se pudo guardar el historial (${errHist.message}).`;
            }

            const mensajeFinal = `¡Proceso finalizado para el Año Lectivo ${anioLectivoActivo}! Estudiantes promovidos: ${promovidosCount}.` +
                (fallidos > 0 ? ` No se pudo promover a ${fallidos} estudiante(s) por un error al guardar.` : ' El detalle quedó guardado en el historial de promociones de ese año.') + avisoHistorial;
            document.querySelectorAll('#promocion-msg, #promocion-msg-matricula').forEach(el => el.innerText = mensajeFinal);

            cargarSelectorEstudiantesEdicion();
            cargarTablaEstudiantesNivel();

            if (confirm(`El proceso del Año Lectivo ${anioLectivoActivo} terminó.\n\n¿Desea avanzar el Año Lectivo Activo del sistema a ${anioLectivoActivo + 1} para comenzar a calificar el nuevo curso? (Los datos de ${anioLectivoActivo} y anteriores quedan guardados intactos)`)) {
                const nuevoAnio = anioLectivoActivo + 1;
                const { error: errAnio } = await supabaseClient.from('configuracion_periodos').update({ anio_lectivo_activo: nuevoAnio }).eq('id', 1);
                if (errAnio) {
                    alert('No se pudo avanzar el Año Lectivo Activo: ' + errAnio.message);
                    return;
                }
                anioLectivoActivo = nuevoAnio;
                const inputAnio = document.getElementById('cfg-anio-activo');
                if (inputAnio) inputAnio.value = anioLectivoActivo;
                const spanAnio = document.getElementById('span-anio-activo-matricula');
                if (spanAnio) spanAnio.textContent = anioLectivoActivo;
                inicializarAniosLectivos();
                alert(`El Año Lectivo Activo ahora es ${anioLectivoActivo}.`);
            }
        }

        async function verHistorialPromociones() {
            const contenedor = document.getElementById('contenedor-historial-promociones');
            if (!contenedor) return;

            const anioConsulta = prompt('¿De qué Año Lectivo desea ver el historial de promociones?', anioLectivoActivo);
            if (!anioConsulta || isNaN(parseInt(anioConsulta, 10))) return;

            contenedor.innerHTML = '<p>Cargando historial...</p>';

            const { data, error } = await supabaseClient.from('historial_promociones').select('*').eq('anio_lectivo', parseInt(anioConsulta, 10)).order('nivel_destino').order('nombre_estudiante');

            if (error) {
                contenedor.innerHTML = '<p style="color: red;">Error al cargar el historial: ' + error.message + ' (recuerde crear la tabla historial_promociones en Supabase).</p>';
                return;
            }

            if (!data || data.length === 0) {
                contenedor.innerHTML = `<p style="color: #64748b;">No hay registros de promoción guardados para el Año Lectivo ${anioConsulta}.</p>`;
                return;
            }

            let html = `
                <h3>Historial de Promoción - Año Lectivo ${anioConsulta}</h3>
                <table class="data-table">
                    <thead>
                        <tr><th>Cédula</th><th style="text-align:left;">Nombre</th><th>Nivel Origen</th><th>Nivel Destino</th><th>Estado</th></tr>
                    </thead>
                    <tbody>
            `;
            data.forEach(r => {
                html += `<tr><td>${escapeHTML(r.cedula_estudiante)}</td><td style="text-align:left;">${escapeHTML(r.nombre_estudiante)}</td><td>${escapeHTML(r.nivel_origen)}</td><td>${escapeHTML(r.nivel_destino)}</td><td>${escapeHTML(r.estado)}</td></tr>`;
            });
            html += '</tbody></table><button type="button" class="action-btn" style="margin-top:10px;" onclick="window.print()">Imprimir esta lista</button>';
            contenedor.innerHTML = html;
        }

        async function cargarContactosPorNivel() {
            const nivel = document.getElementById('contacto-nivel-sel').value;
            const contenedor = document.getElementById('contenedor-lista-contactos');

            if (!nivel) {
                contenedor.innerHTML = '<p style="color: #64748b;">Seleccione un nivel educativo para desplegar la lista de estudiantes y los datos de sus encargados.</p>';
                return;
            }

            contenedor.innerHTML = '<p>Cargando lista de contactos...</p>';

            const { data, error } = await supabaseClient.from('estudiantes').select('*').eq('nivel', nivel).eq('activo', true).order('nombre');

            if (error) {
                contenedor.innerHTML = '<p style="color: red;">Error al cargar contactos: ' + error.message + '</p>';
                return;
            }

            if (!data || data.length === 0) {
                contenedor.innerHTML = `<p style="color: #64748b;">No hay estudiantes registrados en el nivel ${nivel}.</p>`;
                return;
            }

            let html = `
                <h3 style="color: var(--primary);">Directorio de Encargados - Nivel: ${nivel}</h3>
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>Estudiante</th>
                            <th>Cédula</th>
                            <th>Primer Encargado</th>
                            <th>Teléfono 1</th>
                            <th>Correo 1</th>
                            <th>Segundo Encargado</th>
                            <th>Teléfono 2</th>
                            <th>Correo 2</th>
                        </tr>
                    </thead>
                    <tbody>
            `;

            data.forEach(est => {
                html += `
                    <tr>
                        <td style="text-align: left;"><b>${escapeHTML(est.nombre)}</b></td>
                        <td>${escapeHTML(est.cedula)}</td>
                        <td style="text-align: left;">${escapeHTML(est.encargado1_nombre) || 'N/A'}</td>
                        <td>${escapeHTML(est.encargado1_cel) || 'N/A'}</td>
                        <td style="text-align: left;">${escapeHTML(est.encargado1_correo) || 'N/A'}</td>
                        <td style="text-align: left;">${escapeHTML(est.encargado2_nombre) || 'N/A'}</td>
                        <td>${escapeHTML(est.encargado2_cel) || 'N/A'}</td>
                        <td style="text-align: left;">${escapeHTML(est.encargado2_correo) || 'N/A'}</td>
                    </tr>
                `;
            });

            html += `</tbody></table>`;
            contenedor.innerHTML = html;
        }

        async function generarListaOficialVisual() {
            const seleccion = document.getElementById('generar-lista-nivel-sel').value;
            const contenedor = document.getElementById('contenedor-vista-lista-nivel');

            if (!seleccion) {
                contenedor.innerHTML = '<p style="color: #64748b; text-align: center;">Seleccione un nivel o ciclo educativo para generar la lista oficial.</p>';
                return;
            }

            contenedor.innerHTML = '<p>Cargando lista de estudiantes...</p>';

            let nivelesAConsultar = [];
            let tituloCicloNivel = '';

            if (seleccion === 'Primer Ciclo') {
                nivelesAConsultar = ['Primero', 'Segundo', 'Tercero'];
                tituloCicloNivel = 'PRIMER CICLO (PRIMERO, SEGUNDO Y TERCERO)';
            } else if (seleccion === 'Segundo Ciclo') {
                nivelesAConsultar = ['Cuarto', 'Quinto', 'Sexto'];
                tituloCicloNivel = 'SEGUNDO CICLO (CUARTO, QUINTO Y SEXTO)';
            } else {
                nivelesAConsultar = [seleccion];
                tituloCicloNivel = `NIVEL: ${seleccion.toUpperCase()}`;
            }

            await logoEncabezadoListo;
            const { data, error } = await supabaseClient.from('estudiantes').select('*').in('nivel', nivelesAConsultar).eq('activo', true);

            if (error) {
                contenedor.innerHTML = '<p style="color: red;">Error al cargar estudiantes: ' + escapeHTML(error.message) + '</p>';
                return;
            }

            if (!data || data.length === 0) {
                contenedor.innerHTML = `<p style="color: #64748b; text-align: center;">No hay estudiantes matriculados en ${seleccion}.</p>`;
                return;
            }

            data.sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));

            let filasTablaHTML = '';
            data.forEach((est, index) => {
                filasTablaHTML += `
                    <tr>
                        <td>${index + 1}</td>
                        <td style="text-align: center;">${escapeHTML(est.cedula)}</td>
                        <td style="text-align: left;"><b>${escapeHTML(est.nombre)}</b></td>
                        ${seleccion.includes('Ciclo') ? `<td>${escapeHTML(est.nivel)}</td>` : ''}
                    </tr>
                `;
            });

            contenedor.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;" class="no-print">
                    <h3 style="margin: 0; color: var(--primary);">Vista Previa • Lista Oficial (${seleccion})</h3>
                    <div style="display: flex; gap: 10px; flex-wrap: wrap;">
                        <button type="button" class="action-btn" onclick="window.print()">Imprimir / Guardar PDF</button>
                        <button type="button" class="warning-btn" onclick="exportarComoWord('plantilla-lista-nivel-impresion', 'Lista_Oficial_${seleccion.replace(/\\s+/g, '_')}')">Guardar en Word (Editable)</button>
                        <button type="button" class="success-btn" onclick="descargarListaExcel('${seleccion}')">Descargar Excel (CSV)</button>
                    </div>
                </div>

                <div class="report-preview" id="plantilla-lista-nivel-impresion">
                    <div class="encabezado-informe-full" style="width: 100%; margin-bottom: 2px; text-align: center;">
                        <img src="${LOGO_ENCABEZADO_SRC}" alt="Encabezado Institucional Centro Educativo Shkénuk" style="width: 100%; height: auto; display: block; margin: 0 auto;">
                    </div>

                    <div style="text-align: center; margin-bottom: 20px;">
                        <p style="margin: 1px 0; font-size: 11px; color: #64748b;">Dirección Regional de Heredia • Circuito Escolar 04</p>
                        <p style="margin: 1px 0; font-size: 11px; color: #64748b;">Calle El Pedregal 40205, Heredia, Barva, El Carbonal • Tel: 2260-7806</p>
                        <p style="margin: 8px 0 0 0; font-size: 14px; color: var(--accent); font-weight: bold; text-transform: uppercase;">LISTA OFICIAL DE ESTUDIANTES • ${tituloCicloNivel}</p>
                    </div>

                    <div style="margin-bottom: 20px;">
                        <table class="data-table" style="display: table; width: 100%;">
                            <thead>
                                <tr>
                                    <th style="width: 50px;">N.°</th>
                                    <th>Cédula</th>
                                    <th style="text-align: left;">Apellidos y Nombres</th>
                                    ${seleccion.includes('Ciclo') ? '<th>Nivel</th>' : ''}
                                </tr>
                            </thead>
                            <tbody>
                                ${filasTablaHTML}
                            </tbody>
                        </table>
                    </div>
                </div>
            `;
        }

        async function descargarListaExcel(seleccion) {
            let nivelesAConsultar = [];
            if (seleccion === 'Primer Ciclo') nivelesAConsultar = ['Primero', 'Segundo', 'Tercero'];
            else if (seleccion === 'Segundo Ciclo') nivelesAConsultar = ['Cuarto', 'Quinto', 'Sexto'];
            else nivelesAConsultar = [seleccion];

            const { data, error } = await supabaseClient.from('estudiantes').select('cedula, nombre, nivel').in('nivel', nivelesAConsultar).eq('activo', true);

            if (error || !data || data.length === 0) {
                alert('No hay estudiantes para exportar.');
                return;
            }

            data.sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));

            let csvContent = `\uFEFF"LISTA OFICIAL - ${seleccion.toUpperCase()}"\n`;
            csvContent += '"N°","Cédula","Apellidos y Nombres","Nivel"\n';

            data.forEach((est, index) => {
                const fila = [
                    index + 1,
                    csvCelda(est.cedula),
                    csvCelda(est.nombre),
                    csvCelda(est.nivel)
                ].join(',');
                csvContent += fila + '\n';
            });

            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.setAttribute('href', url);
            link.setAttribute('download', `Lista_Oficial_${seleccion.replace(/\s+/g, '_')}.csv`);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }

        // =====================================================================
        // CONTROL FINANCIERO
        // - Matrícula (matricula_pagada) y Materiales (materiales_sem1_pagado /
        //   materiales_sem2_pagado) viven como columnas directas en
        //   "estudiantes": son eventos anuales/semestrales, un solo clic, sin
        //   necesidad de elegir periodo.
        // - Mensualidad de permanencia vive en la tabla "control_financiero"
        //   (una fila por estudiante/mes), igual patrón que ya se usa con
        //   "notas": upsert con onConflict 'cedula_estudiante,periodo_mes'.
        // =====================================================================
        const MESES_FINANCIERO = [
            { num: '02', nombre: 'Febrero' }, { num: '03', nombre: 'Marzo' },
            { num: '04', nombre: 'Abril' }, { num: '05', nombre: 'Mayo' }, { num: '06', nombre: 'Junio' },
            { num: '07', nombre: 'Julio' }, { num: '08', nombre: 'Agosto' }, { num: '09', nombre: 'Septiembre' },
            { num: '10', nombre: 'Octubre' }, { num: '11', nombre: 'Noviembre' }, { num: '12', nombre: 'Diciembre' }
        ];

        function inicializarSelectMesesFinanciero(idSelect) {
            const select = document.getElementById(idSelect);
            if (!select) return;
            select.innerHTML = '';
            const mesActual = String(new Date().getMonth() + 1).padStart(2, '0');
            MESES_FINANCIERO.forEach(m => {
                const opt = document.createElement('option');
                opt.value = m.num;
                opt.textContent = m.nombre;
                if (m.num === mesActual) opt.selected = true;
                select.appendChild(opt);
            });
        }

        // ---------- SUB-PANEL 1: MATRÍCULA Y MATERIALES ----------
        async function cargarTablaMatriculaMateriales() {
            const contenedor = document.getElementById('contenedor-fin-matmat');
            const nivel = document.getElementById('fin-matmat-nivel-sel').value;
            contenedor.innerHTML = '<p>Cargando estudiantes...</p>';

            let query = supabaseClient.from('estudiantes').select('cedula, nombre, nivel, matricula_pagada, materiales_sem1_pagado, materiales_sem2_pagado').eq('activo', true);
            if (nivel) query = query.eq('nivel', nivel);
            const { data, error } = await query.order('nivel').order('nombre');

            if (error) {
                contenedor.innerHTML = '<p style="color: red;">Error al cargar estudiantes: ' + error.message + '</p>';
                return;
            }
            if (!data || data.length === 0) {
                contenedor.innerHTML = '<p style="color: #64748b; text-align: center;">No hay estudiantes matriculados.</p>';
                return;
            }

            let filas = '';
            data.forEach(est => {
                filas += `
                    <tr>
                        <td style="text-align: left;"><b>${escapeHTML(est.nombre)}</b></td>
                        <td>${escapeHTML(est.nivel)}</td>
                        <td><input type="checkbox" style="width: 18px; height: 18px; cursor: pointer;" ${est.matricula_pagada ? 'checked' : ''} onchange="guardarEstadoPagoAnual(this, '${escapeHTML(est.cedula)}', 'matricula_pagada')"></td>
                        <td><input type="checkbox" style="width: 18px; height: 18px; cursor: pointer;" ${est.materiales_sem1_pagado ? 'checked' : ''} onchange="guardarEstadoPagoAnual(this, '${escapeHTML(est.cedula)}', 'materiales_sem1_pagado')"></td>
                        <td><input type="checkbox" style="width: 18px; height: 18px; cursor: pointer;" ${est.materiales_sem2_pagado ? 'checked' : ''} onchange="guardarEstadoPagoAnual(this, '${escapeHTML(est.cedula)}', 'materiales_sem2_pagado')"></td>
                    </tr>
                `;
            });

            contenedor.innerHTML = `
                <table class="data-table">
                    <thead>
                        <tr>
                            <th style="text-align: left;">Estudiante</th>
                            <th>Nivel</th>
                            <th>Matrícula</th>
                            <th>Materiales I Sem.</th>
                            <th>Materiales II Sem.</th>
                        </tr>
                    </thead>
                    <tbody>${filas}</tbody>
                </table>
            `;
        }

        async function guardarEstadoPagoAnual(checkbox, cedula, campo) {
            checkbox.disabled = true;
            try {
                const { error } = await supabaseClient.from('estudiantes').update({ [campo]: checkbox.checked }).eq('cedula', cedula);
                if (error) {
                    checkbox.checked = !checkbox.checked;
                    alert('Error al guardar: ' + error.message);
                }
            } catch (e) {
                // Sin este try/catch, un corte de red dejaba la casilla
                // deshabilitada para siempre (checkbox.disabled nunca volvía
                // a false), rompiendo el control financiero a mitad de uso.
                checkbox.checked = !checkbox.checked;
                alert('Sin conexión: no se pudo guardar el pago. Intente de nuevo.');
            } finally {
                checkbox.disabled = false;
            }
        }

        // ---------- SUB-PANEL 2: MENSUALIDADES (cuadrícula mes a mes) ----------
        async function cargarGrillaMensualidades() {
            const contenedor = document.getElementById('contenedor-fin-mensual');
            const nivel = document.getElementById('fin-mensual-nivel-sel').value;
            const anio = document.getElementById('fin-mensual-anio-sel').value || anioLectivoActivo;
            contenedor.innerHTML = '<p>Cargando estudiantes...</p>';

            let queryEst = supabaseClient.from('estudiantes').select('cedula, nombre, nivel').eq('activo', true);
            if (nivel) queryEst = queryEst.eq('nivel', nivel);
            const { data: estudiantes, error: errEst } = await queryEst.order('nivel').order('nombre');

            if (errEst) {
                contenedor.innerHTML = '<p style="color: red;">Error al cargar estudiantes: ' + errEst.message + '</p>';
                return;
            }
            if (!estudiantes || estudiantes.length === 0) {
                contenedor.innerHTML = '<p style="color: #64748b; text-align: center;">No hay estudiantes matriculados.</p>';
                return;
            }

            const { data: pagos, error: errPagos } = await supabaseClient.from('control_financiero').select('cedula_estudiante, periodo_mes, mensualidad_pagada').eq('anio_lectivo', parseInt(anio, 10));

            if (errPagos) {
                contenedor.innerHTML = '<p style="color: red;">Error al cargar mensualidades: ' + errPagos.message + '</p>';
                return;
            }

            let filas = '';
            estudiantes.forEach(est => {
                filas += `<tr><td style="text-align: left;"><b>${escapeHTML(est.nombre)}</b></td><td>${escapeHTML(est.nivel)}</td>`;
                MESES_FINANCIERO.forEach(m => {
                    const periodoMes = `${anio}-${m.num}`;
                    const registro = pagos ? pagos.find(p => p.cedula_estudiante === est.cedula && p.periodo_mes === periodoMes) : null;
                    const pagada = registro ? registro.mensualidad_pagada : false;
                    filas += `<td><input type="checkbox" style="width: 18px; height: 18px; cursor: pointer;" ${pagada ? 'checked' : ''} onchange="guardarMensualidad(this, '${escapeHTML(est.cedula)}', '${periodoMes}', ${anio})"></td>`;
                });
                filas += `</tr>`;
            });

            const encabezadoMeses = MESES_FINANCIERO.map(m => `<th>${m.nombre.substring(0, 3)}</th>`).join('');

            contenedor.innerHTML = `
                <table class="data-table">
                    <thead>
                        <tr>
                            <th style="text-align: left;">Estudiante</th>
                            <th>Nivel</th>
                            ${encabezadoMeses}
                        </tr>
                    </thead>
                    <tbody>${filas}</tbody>
                </table>
            `;
        }

        async function guardarMensualidad(checkbox, cedula, periodoMes, anio) {
            checkbox.disabled = true;
            const datos = {
                cedula_estudiante: String(cedula),
                periodo_mes: String(periodoMes),
                anio_lectivo: parseInt(anio, 10),
                mensualidad_pagada: checkbox.checked
            };
            try {
                const { error } = await supabaseClient.from('control_financiero').upsert([datos], { onConflict: 'cedula_estudiante,periodo_mes' });
                if (error) {
                    checkbox.checked = !checkbox.checked;
                    alert('Error al guardar: ' + error.message);
                }
            } catch (e) {
                checkbox.checked = !checkbox.checked;
                alert('Sin conexión: no se pudo guardar la mensualidad. Intente de nuevo.');
            } finally {
                checkbox.disabled = false;
            }
        }

        // ---------- SUB-PANEL 3: ESTADÍSTICAS ----------
        async function cargarEstadisticasFinancieras() {
            const contenedor = document.getElementById('contenedor-fin-stats');
            const anio = document.getElementById('fin-stats-anio-sel').value || anioLectivoActivo;
            const mes = document.getElementById('fin-stats-mes-sel').value || String(new Date().getMonth() + 1).padStart(2, '0');
            const periodoMes = `${anio}-${mes}`;
            contenedor.innerHTML = '<p>Calculando estadísticas...</p>';

            const { data: estudiantes, error: errEst } = await supabaseClient.from('estudiantes').select('cedula, nombre, nivel, matricula_pagada, materiales_sem1_pagado, materiales_sem2_pagado').eq('activo', true);

            if (errEst) {
                contenedor.innerHTML = '<p style="color: red;">Error: ' + errEst.message + '</p>';
                return;
            }
            if (!estudiantes || estudiantes.length === 0) {
                contenedor.innerHTML = '<p style="color: #64748b;">No hay estudiantes activos.</p>';
                return;
            }

            const { data: pagosMes } = await supabaseClient.from('control_financiero').select('cedula_estudiante, mensualidad_pagada').eq('periodo_mes', periodoMes).eq('anio_lectivo', parseInt(anio, 10));

            const total = estudiantes.length;
            const matriculaAlDia = estudiantes.filter(e => e.matricula_pagada).length;
            const sem1AlDia = estudiantes.filter(e => e.materiales_sem1_pagado).length;
            const sem2AlDia = estudiantes.filter(e => e.materiales_sem2_pagado).length;

            const cedulasPagadasMes = new Set((pagosMes || []).filter(p => p.mensualidad_pagada).map(p => p.cedula_estudiante));
            const mensualidadAlDia = cedulasPagadasMes.size;
            const morosos = estudiantes.filter(e => !cedulasPagadasMes.has(e.cedula));

            const pct = (n) => total > 0 ? Math.round((n / total) * 100) : 0;
            const nombreMes = (MESES_FINANCIERO.find(m => m.num === mes) || {}).nombre || mes;

            const tarjeta = (titulo, n, color) => `
                <div style="background: #fff; border: 1px solid var(--border); border-radius: 8px; padding: 18px; text-align: center; min-width: 160px; flex: 1;">
                    <div style="font-size: 12px; color: #64748b; font-weight: 600; margin-bottom: 6px;">${titulo}</div>
                    <div style="font-size: 26px; font-weight: bold; color: ${color};">${pct(n)}%</div>
                    <div style="font-size: 11px; color: #94a3b8;">${n} de ${total} estudiantes</div>
                </div>
            `;

            const filasMorosos = morosos.length > 0
                ? morosos.map(e => `<tr><td style="text-align: left;">${escapeHTML(e.nombre)}</td><td>${escapeHTML(e.nivel)}</td></tr>`).join('')
                : `<tr><td colspan="2" style="color: #166534;">¡Todos al día este mes!</td></tr>`;

            contenedor.innerHTML = `
                <div style="display: flex; flex-wrap: wrap; gap: 15px; margin-bottom: 25px;">
                    ${tarjeta('Matrícula Pagada', matriculaAlDia, '#166534')}
                    ${tarjeta('Materiales I Sem.', sem1AlDia, '#2563eb')}
                    ${tarjeta('Materiales II Sem.', sem2AlDia, '#2563eb')}
                    ${tarjeta(`Mensualidad al Día (${nombreMes})`, mensualidadAlDia, '#d97706')}
                </div>
                <h3 style="color: var(--primary);">Estudiantes Morosos en Mensualidad — ${nombreMes} ${anio} (${morosos.length})</h3>
                <table class="data-table">
                    <thead><tr><th style="text-align: left;">Estudiante</th><th>Nivel</th></tr></thead>
                    <tbody>${filasMorosos}</tbody>
                </table>
            `;
        }

        // ---------- SUB-PANEL 4: REPORTE / ESTADO DE CUENTA ----------
        async function cargarEstudiantesReporteFinanciero() {
            const nivel = document.getElementById('fin-rep-nivel-sel').value;
            const selectEstudiantes = document.getElementById('fin-rep-estudiante-sel');
            selectEstudiantes.innerHTML = '<option value="">Cargando lista...</option>';
            document.getElementById('contenedor-vista-reporte-fin').innerHTML = '<p style="color: #64748b; text-align: center;">Seleccione nivel, estudiante y mes de corte para generar el estado de cuenta.</p>';

            if (!nivel) {
                selectEstudiantes.innerHTML = '<option value="">Primero seleccione un nivel</option>';
                return;
            }

            const { data, error } = await supabaseClient.from('estudiantes').select('*').eq('nivel', nivel).eq('activo', true).order('nombre');
            if (error || !data || data.length === 0) {
                selectEstudiantes.innerHTML = '<option value="">No hay estudiantes en este nivel</option>';
                return;
            }

            selectEstudiantes.innerHTML = '<option value="">Seleccione un estudiante</option>';
            data.forEach(est => {
                const opt = document.createElement('option');
                opt.value = est.cedula;
                opt.textContent = `${est.nombre} (Cédula: ${est.cedula})`;
                opt.dataset.estudiante = JSON.stringify(est);
                selectEstudiantes.appendChild(opt);
            });
        }

        async function generarReporteFinancieroVisual() {
            const selectEst = document.getElementById('fin-rep-estudiante-sel');
            const mesCorte = document.getElementById('fin-rep-mes-sel').value;
            const contenedor = document.getElementById('contenedor-vista-reporte-fin');

            if (!selectEst.value || !mesCorte) {
                contenedor.innerHTML = '<p style="color: #64748b; text-align: center;">Seleccione nivel, estudiante y mes de corte para generar el estado de cuenta.</p>';
                return;
            }

            contenedor.innerHTML = '<p>Generando estado de cuenta...</p>';
            await logoEncabezadoListo;
            const estData = JSON.parse(selectEst.options[selectEst.selectedIndex].dataset.estudiante);
            const anio = anioLectivoActivo;

            const { data: pagos } = await supabaseClient.from('control_financiero').select('periodo_mes, mensualidad_pagada').eq('cedula_estudiante', estData.cedula).eq('anio_lectivo', parseInt(anio, 10));

            // Meses a evaluar: desde Febrero hasta el mes de corte elegido (inclusive)
            const indiceCorte = MESES_FINANCIERO.findIndex(m => m.num === mesCorte);
            const mesesAEvaluar = MESES_FINANCIERO.slice(0, indiceCorte + 1);

            const pendientes = [];
            const filasPorMes = [];
            mesesAEvaluar.forEach(m => {
                const periodoMes = `${anio}-${m.num}`;
                const registro = pagos ? pagos.find(p => p.periodo_mes === periodoMes) : null;
                const pagada = registro ? registro.mensualidad_pagada : false;
                if (!pagada) pendientes.push(`Mensualidad de ${m.nombre}`);
                filasPorMes.push(`<tr><td style="text-align: left;">Mensualidad — ${m.nombre} ${anio}</td><td>${pagada ? '<span style="color: #166534; font-weight: bold;">Pagado ✔</span>' : '<span style="color: #991b1b; font-weight: bold;">Pendiente ✘</span>'}</td></tr>`);
            });

            // Misma tabla Concepto/Estado de siempre, pero partida en 2 columnas
            // lado a lado (en vez de una sola columna larga) para que quepa en una hoja.
            const mitad = Math.ceil(filasPorMes.length / 2);
            const columnaIzquierda = filasPorMes.slice(0, mitad).join('');
            const columnaDerecha = filasPorMes.slice(mitad).join('');
            const tablaMensualidad = (filas) => filas ? `
                <table class="data-table" style="display: table; width: 100%; font-size: 10.5px; flex: 1;">
                    <thead><tr><th>Concepto</th><th>Estado</th></tr></thead>
                    <tbody>${filas}</tbody>
                </table>
            ` : '';
            const gridMensualidad = `
                <div style="display: flex; gap: 10px;">
                    ${tablaMensualidad(columnaIzquierda)}
                    ${tablaMensualidad(columnaDerecha)}
                </div>
            `;

            // Materiales I Sem. se exige a partir de Marzo, II Sem. a partir de Agosto
            const requiereSem1 = mesCorte >= '03';
            const requiereSem2 = mesCorte >= '08';

            if (!estData.matricula_pagada) pendientes.push('Matrícula');
            if (requiereSem1 && !estData.materiales_sem1_pagado) pendientes.push('Materiales I Semestre');
            if (requiereSem2 && !estData.materiales_sem2_pagado) pendientes.push('Materiales II Semestre');

            const estaAlDia = pendientes.length === 0;
            const pendientesAnuales = pendientes.filter(p => !p.startsWith('Mensualidad de'));
            const nombreMesCorte = (MESES_FINANCIERO.find(m => m.num === mesCorte) || {}).nombre || mesCorte;

            const filasConceptosAnuales = `
                <tr><td style="text-align: left;">Matrícula ${anio}</td><td>${estData.matricula_pagada ? '<span style="color: #166534; font-weight: bold;">Pagado ✔</span>' : '<span style="color: #991b1b; font-weight: bold;">Pendiente ✘</span>'}</td></tr>
                ${requiereSem1 ? `<tr><td style="text-align: left;">Materiales I Semestre</td><td>${estData.materiales_sem1_pagado ? '<span style="color: #166534; font-weight: bold;">Pagado ✔</span>' : '<span style="color: #991b1b; font-weight: bold;">Pendiente ✘</span>'}</td></tr>` : ''}
                ${requiereSem2 ? `<tr><td style="text-align: left;">Materiales II Semestre</td><td>${estData.materiales_sem2_pagado ? '<span style="color: #166534; font-weight: bold;">Pagado ✔</span>' : '<span style="color: #991b1b; font-weight: bold;">Pendiente ✘</span>'}</td></tr>` : ''}
            `;

            const bloqueAlDia = `
                <div style="border: 2px solid #166534; background: #f0fdf4; padding: 8px 12px; border-radius: 8px; margin-top: 10px;">
                    <h4 style="color: #166534; margin: 0 0 4px 0; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; text-align: center;">Al Día con sus Obligaciones</h4>
                    <p style="margin: 0 0 5px 0; font-size: 10.5px; color: #14532d; line-height: 1.35; text-align: justify;">
                        Estimada familia, reciban un cordial saludo de parte del Centro Educativo Shkénuk / CES Montessori. Nos complace informarles que el
                        estudiante <b>${escapeHTML(estData.nombre)}</b> se encuentra al día con sus obligaciones financieras al corte de <b>${nombreMesCorte} de ${anio}</b>,
                        sin ningún rubro pendiente de regularizar.
                    </p>
                    <p style="margin: 0; font-size: 10.5px; color: #14532d; line-height: 1.35; text-align: justify;">
                        Agradecemos su puntualidad y compromiso, fundamentales para sostener la calidad educativa que ofrecemos. Contamos con su continuo
                        apoyo en la formación de su hijo(a).
                    </p>
                </div>
            `;

            const bloqueMoroso = `
                <div style="border: 2px solid #9a3412; background: #fff7ed; padding: 8px 12px; border-radius: 8px; margin-top: 10px;">
                    <h4 style="color: #9a3412; margin: 0 0 4px 0; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; text-align: center;">Aviso Importante — Estado de Cuenta Pendiente</h4>
                    <p style="margin: 0 0 5px 0; font-size: 10.5px; color: #7c2d12; line-height: 1.35; text-align: justify;">
                        Estimada familia, reciban un cordial saludo de parte del Centro Educativo Shkénuk / CES Montessori. Por medio de la presente deseamos
                        recordarles, con el mayor respeto, la importancia de mantener al día las obligaciones financieras adquiridas al momento de la matrícula
                        del estudiante <b>${escapeHTML(estData.nombre)}</b>, ya que estas nos permiten sostener la calidad académica, los materiales y el bienestar de toda
                        nuestra comunidad educativa.
                    </p>
                    <p style="margin: 0 0 8px 0; font-size: 10.5px; color: #7c2d12; line-height: 1.35; text-align: justify;">
                        Les agradecemos de antemano gestionar la regularización de este saldo a la mayor brevedad posible. Si existiera alguna situación
                        particular que dificulte el pago, les invitamos con toda confianza a coordinar directamente con la administración para buscar juntos
                        la mejor solución. Contamos con su comprensión y con su valioso compromiso en la formación de su hijo(a).
                    </p>
                    <p style="margin: 0; font-size: 10.5px; color: #7c2d12; line-height: 1.35;">
                        Atentamente,<br>
                        <b>Flor María Jiménez Bolaños</b><br>
                        Directora
                    </p>
                </div>
            `;

            contenedor.innerHTML = `
                <div style="display: flex; justify-content: flex-end; gap: 10px; margin-bottom: 15px;">
                    <button type="button" class="action-btn" onclick="descargarReporteFinancieroPDF()">Descargar en PDF</button>
                    <button type="button" class="warning-btn" onclick="exportarComoWord('plantilla-reporte-financiero', 'Estado_Cuenta_${estData.nombre.replace(/[^\p{L}\p{N}]+/gu, '_')}')">Guardar en Word (Editable)</button>
                </div>

                <div class="report-preview" id="plantilla-reporte-financiero">
                    <div class="encabezado-informe-full">
                        <img src="${LOGO_ENCABEZADO_SRC}" alt="Encabezado Institucional Centro Educativo Shkénuk">
                    </div>

                    <div style="text-align: center; margin-bottom: 4px;">
                        <p style="margin: 0; font-size: 14px; color: #000000; font-weight: bold; text-transform: uppercase;">Estado de Cuenta ${anio}</p>
                        <p style="margin: 2px 0 0 0; font-size: 11px; color: #000000; font-weight: bold; text-transform: uppercase;">Dirección Regional de Heredia - Circuito Escolar 04</p>
                        <p style="margin: 2px 0 0 0; font-size: 11px; color: #000000; font-weight: bold; text-transform: uppercase;">Centro Educativo Shkénuk</p>
                    </div>

                    <div style="margin-bottom: 6px; font-size: 11px; background: #f8fafc; padding: 6px 10px; border-radius: 6px; border: 1px solid var(--border); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                        <b>Estudiante:</b> ${escapeHTML(estData.nombre)} &nbsp;&nbsp;|&nbsp;&nbsp; <b>Cédula:</b> ${escapeHTML(estData.cedula)} &nbsp;&nbsp;|&nbsp;&nbsp; <b>Nivel:</b> ${escapeHTML(estData.nivel)} &nbsp;&nbsp;|&nbsp;&nbsp; <b>Corte:</b> ${nombreMesCorte} ${anio}
                    </div>

                    <div style="margin-bottom: 6px;">
                        <h4 style="color: var(--primary); margin: 0 0 4px 0; font-size: 12px;">Detalle de Rubros Anuales / Semestrales</h4>
                        <table class="data-table" style="display: table; width: 100%; font-size: 11px;">
                            <thead><tr><th>Concepto</th><th>Estado</th></tr></thead>
                            <tbody>${filasConceptosAnuales}</tbody>
                        </table>
                    </div>

                    <div style="margin-bottom: 6px;">
                        <h4 style="color: var(--primary); margin: 0 0 4px 0; font-size: 12px;">Detalle de Mensualidades (Febrero a ${nombreMesCorte})</h4>
                        ${gridMensualidad}
                    </div>

                    ${estaAlDia ? bloqueAlDia : bloqueMoroso}
                </div>
            `;
        }

        function descargarReporteFinancieroPDF() {
            const elementoReporte = document.getElementById('plantilla-reporte-financiero');
            const selectEst = document.getElementById('fin-rep-estudiante-sel');
            const msg = document.getElementById('fin-rep-msg');

            if (!elementoReporte || !selectEst.value) {
                alert('Por favor genere y visualice primero el estado de cuenta de un estudiante antes de descargarlo.');
                return;
            }

            const estData = JSON.parse(selectEst.options[selectEst.selectedIndex].dataset.estudiante);
            const nombreArchivo = `Estado_Cuenta_${estData.nombre.replace(/[^\p{L}\p{N}]+/gu, '_')}_${anioLectivoActivo}.pdf`;

            msg.className = 'notification success';
            msg.innerText = 'Generando archivo PDF en formato A4, por favor espere...';
            msg.style.display = 'block';

            const opciones = {
                margin:       [10, 10, 10, 10],
                filename:     nombreArchivo,
                image:        { type: 'jpeg', quality: 0.98 },
                html2canvas:  { scale: 2, useCORS: true, letterRendering: true },
                jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' }
            };

            html2pdf().from(elementoReporte).set(opciones).save().then(() => {
                msg.innerText = `¡El estado de cuenta se ha descargado exitosamente como "${nombreArchivo}"!`;
                setTimeout(() => { msg.style.display = 'none'; }, 5000);
            }).catch(err => {
                msg.className = 'notification error';
                msg.innerText = 'Error al generar el PDF: ' + err;
            });
        }

        // =====================================================================
        // SEGURIDAD — Verificación en Dos Pasos (MFA con app autenticadora)
        // =====================================================================
        let factorIdEnProcesoMFA = '';

        async function cargarEstadoMFA() {
            const textoEstado = document.getElementById('mfa-estado-texto');
            const fieldsetActivar = document.getElementById('mfa-fieldset-activar');
            const fieldsetDesactivar = document.getElementById('mfa-fieldset-desactivar');

            document.getElementById('mfa-paso-inicial').style.display = 'block';
            document.getElementById('mfa-paso-qr').style.display = 'none';

            const { data, error } = await supabaseClient.auth.mfa.listFactors();
            if (error) {
                textoEstado.innerHTML = '<span style="color: red;">Error al consultar el estado: ' + error.message + '</span>';
                return;
            }

            const factorVerificado = (data.totp || []).find(f => f.status === 'verified');

            if (factorVerificado) {
                textoEstado.innerHTML = '<span style="color: #166534; font-weight: bold;">✔ Verificación en dos pasos ACTIVADA</span>';
                fieldsetActivar.style.display = 'none';
                fieldsetDesactivar.style.display = 'block';
                factorIdEnProcesoMFA = factorVerificado.id;
            } else {
                textoEstado.innerHTML = '<span style="color: #92400e; font-weight: bold;">✘ Verificación en dos pasos DESACTIVADA</span>';
                fieldsetActivar.style.display = 'block';
                fieldsetDesactivar.style.display = 'none';
            }
        }

        async function iniciarActivacionMFA() {
            const msg = document.getElementById('mfa-activar-msg');
            msg.style.display = 'none';

            const { data, error } = await supabaseClient.auth.mfa.enroll({ factorType: 'totp' });
            if (error) {
                msg.className = 'notification error';
                msg.innerText = 'Error al generar el código QR: ' + error.message;
                msg.style.display = 'block';
                return;
            }

            factorIdEnProcesoMFA = data.id;
            // OJO: data.totp.qr_code es un SVG en texto plano (con sus
            // propias comillas dobles adentro). Si se mete directo en un
            // string tipo `<img src="${...}">`, las comillas del SVG
            // cortan el atributo a la mitad y el resto se escapa como
            // texto suelto en la página (eso rompía visualmente el QR).
            // Por eso aquí se crea la imagen con JS y se asigna el src
            // como PROPIEDAD, nunca como texto insertado en HTML.
            const contenedorQR = document.getElementById('mfa-qr-contenedor');
            contenedorQR.innerHTML = '';
            const imgQR = document.createElement('img');
            imgQR.src = data.totp.qr_code;
            imgQR.alt = 'Código QR MFA';
            imgQR.style.width = '180px';
            imgQR.style.height = '180px';
            contenedorQR.appendChild(imgQR);
            document.getElementById('mfa-secreto-texto').innerText = data.totp.secret;
            document.getElementById('mfa-paso-inicial').style.display = 'none';
            document.getElementById('mfa-paso-qr').style.display = 'block';
        }

        async function confirmarActivacionMFA() {
            const codigo = document.getElementById('mfa-codigo-confirmacion').value.trim();
            const msg = document.getElementById('mfa-activar-msg');

            if (!codigo || codigo.length !== 6) {
                msg.className = 'notification error';
                msg.innerText = 'Ingrese el código de 6 dígitos que muestra su app.';
                msg.style.display = 'block';
                return;
            }

            const { data: challengeData, error: challengeError } = await supabaseClient.auth.mfa.challenge({ factorId: factorIdEnProcesoMFA });
            if (challengeError) {
                msg.className = 'notification error';
                msg.innerText = 'Error: ' + challengeError.message;
                msg.style.display = 'block';
                return;
            }

            const { error: verifyError } = await supabaseClient.auth.mfa.verify({
                factorId: factorIdEnProcesoMFA,
                challengeId: challengeData.id,
                code: codigo
            });

            if (verifyError) {
                msg.className = 'notification error';
                msg.innerText = 'Código incorrecto. Verifique la hora de su celular y vuelva a intentar.';
                msg.style.display = 'block';
                return;
            }

            msg.className = 'notification success';
            msg.innerText = '¡Verificación en dos pasos activada con éxito!';
            msg.style.display = 'block';
            setTimeout(() => cargarEstadoMFA(), 1500);
        }

        async function desactivarMFA() {
            const msg = document.getElementById('mfa-desactivar-msg');
            if (!confirm('¿Está seguro de desactivar la verificación en dos pasos? Su cuenta quedará protegida solo con la contraseña.')) return;

            const { error } = await supabaseClient.auth.mfa.unenroll({ factorId: factorIdEnProcesoMFA });
            if (error) {
                msg.className = 'notification error';
                msg.innerText = 'Error al desactivar: ' + error.message;
                msg.style.display = 'block';
                return;
            }

            msg.className = 'notification success';
            msg.innerText = 'Verificación en dos pasos desactivada.';
            msg.style.display = 'block';
            setTimeout(() => cargarEstadoMFA(), 1500);
        }

        // ============================================================
        // Auto-exclusión de Taller de Percusión para estudiantes de
        // Batería: al elegir "Batería" como instrumento (principal o
        // segundo) en el formulario de Matrícula, marca sola la casilla
        // "No lleva Taller de Percusión" y desactiva ese select — para que
        // nadie tenga que acordarse de marcarlo a mano. El guardado real
        // (guardarOActualizarMatricula) ya queda protegido igual aunque
        // esta parte visual fallara por cualquier motivo.
        // Docentes con profesor FIJO para un instrumento específico, sin
        // importar el ciclo del estudiante (nombre oficial exacto, tal como
        // está en el Directorio). Cualquier instrumento que NO esté en esta
        // lista (Piano, Guitarra, Ukulele, Bajo, Otro) sigue la regla de
        // ciclo normal (DOCENTE_POR_CICLO: Mariangel en Primer Ciclo,
        // Cativo en Segundo Ciclo).
        const DOCENTE_FIJO_POR_INSTRUMENTO = {
            'Batería': 'Luis De la O Jimenez',
            'Canto': 'Amanda Obregón Apéstegui'
        };

        // Sugiere el profesor correcto apenas se elige un instrumento
        // (principal o segundo): primero revisa si ese instrumento tiene
        // profesor fijo (Batería→Luis, Canto→Amanda); si no, usa el
        // profesor de instrumentos del ciclo del estudiante (Mariangel o
        // Cativo). No hace nada si el select de instrumento quedó vacío.
        function sugerirDocentePorInstrumento(selInstrumento, selDocente) {
            if (!selInstrumento || !selDocente) return;
            const instrumento = selInstrumento.value;
            if (!instrumento) return;

            if (DOCENTE_FIJO_POR_INSTRUMENTO[instrumento]) {
                selDocente.value = DOCENTE_FIJO_POR_INSTRUMENTO[instrumento];
                return;
            }

            const nivel = document.getElementById('mat-nivel') ? document.getElementById('mat-nivel').value : '';
            const defaults = DOCENTE_POR_CICLO[nivelACiclo(nivel)];
            if (defaults && defaults.instrumento) {
                selDocente.value = defaults.instrumento;
            }
        }

        function sincronizarNoLlevaPercusionUI(sugerir) {
            const selPrincipal = document.getElementById('mat-instr-principal');
            const selSegundo = document.getElementById('mat-instr-segundo');
            const chkNoLleva = document.getElementById('mat-no-percusion');
            const selDocentePercursion = document.getElementById('mat-doc-percursion');
            const selDocenteInstrPrincipal = document.getElementById('mat-docente-asig');
            const selDocenteInstrSegundo = document.getElementById('mat-docente-segundo');
            if (!selPrincipal || !selSegundo || !chkNoLleva || !selDocentePercursion) return;

            const esBateria = selPrincipal.value === 'Batería' || selSegundo.value === 'Batería';
            if (esBateria) {
                chkNoLleva.checked = true;
                chkNoLleva.disabled = true; // es automático por Batería, no manual
                chkNoLleva.title = 'Automático: los estudiantes de Batería no llevan Taller de Percusión';
                selDocentePercursion.disabled = true;
            } else {
                chkNoLleva.disabled = false;
                chkNoLleva.title = '';
                // Solo reactiva el select si el docente no lo había marcado
                // manualmente aparte (para no pisar una marca manual real).
                if (!chkNoLleva.checked) selDocentePercursion.disabled = false;
            }

            // Sugiere el profesor de instrumento correcto (fijo por
            // instrumento, o por ciclo si no tiene profesor fijo) apenas
            // se elige el instrumento principal o el segundo. Esto evita
            // que quede en blanco (como pasó con Octavio) o con el docente
            // equivocado, lo cual bloqueaba el guardado de notas por el
            // permiso de seguridad de Supabase.
            // Solo cuando la persona CAMBIA el instrumento: al abrir un estudiante ya
            // matriculado no se debe pisar el profesor que ya tiene asignado.
            if (sugerir === true) {
                sugerirDocentePorInstrumento(selPrincipal, selDocenteInstrPrincipal);
                sugerirDocentePorInstrumento(selSegundo, selDocenteInstrSegundo);
            }
        }

        (function inicializarSincroniaPercusion() {
            const selPrincipal = document.getElementById('mat-instr-principal');
            const selSegundo = document.getElementById('mat-instr-segundo');
            if (selPrincipal) selPrincipal.addEventListener('change', () => sincronizarNoLlevaPercusionUI(true));
            if (selSegundo) selSegundo.addEventListener('change', () => sincronizarNoLlevaPercusionUI(true));
            // Estado inicial al cargar el formulario (por si ya trae un
            // estudiante con Batería seleccionado al editar).
            sincronizarNoLlevaPercusionUI();

            // Docente por defecto según ciclo (Solfeo/Instrumento/Académico):
            // se recalcula cada vez que cambia el Nivel en matrícula nueva.
            const selNivel = document.getElementById('mat-nivel');
            if (selNivel) selNivel.addEventListener('change', () => {
                aplicarDocentePorCicloDefault();
                // Si el instrumento ya elegido tiene profesor FIJO (Batería,
                // Canto), que ese mande sobre el valor por ciclo que
                // acabamos de aplicar arriba (ej. no perder a Luis si ya
                // habían elegido Batería y luego cambian el Nivel).
                sincronizarNoLlevaPercusionUI(document.getElementById('select-estudiante-editar').value === '');
            });
        })();

        // =====================================================================
        // HISTORIAL DE EVALUACIONES Y REFLEXIONES (ambos períodos, con docente)
        //
        // Antes no existía ninguna pantalla que juntara, por estudiante y materia,
        // la nota y la reflexión de los DOS períodos con el nombre del docente.
        // Esta pestaña lo hace con el mismo cruce (resolverNota) que usan el informe
        // y la hoja de calificar, y agrega una columna de CONTROL que marca lo que
        // falta o está mal guardado (sin reflexión, sin registro, otro año, materia
        // con nombre antiguo, materia sin docente).
        //   - Docente: ve solo las materias que le corresponden.
        //   - Administrador: ve todo y puede filtrar por docente.
        // La pestaña se agrega desde aquí (no requiere tocar app-shell.html).
        // =====================================================================
        let historialCache = null;
        let historialDocentes = null;

        function inyectarPestanaHistorial() {
            const nav = document.getElementById('app-nav');
            const principal = document.querySelector('main');
            if (!nav || !principal) return;

            if (!nav.querySelector('[data-tab="historial"]')) {
                const btn = document.createElement('button');
                btn.className = 'tab-btn';
                btn.setAttribute('data-tab', 'historial');
                btn.setAttribute('data-role-req', 'all');
                btn.textContent = 'Historial';
                btn.addEventListener('click', (e) => cambiarPestana('historial', e));
                nav.insertBefore(btn, nav.querySelector('[data-tab="mimatricula"]')); // justo después de "Calificar"
            }

            if (!document.getElementById('historial')) {
                const sec = document.createElement('section');
                sec.id = 'historial';
                sec.className = 'tab-content';
                sec.innerHTML = `
                    <h2>Historial de Evaluaciones y Reflexiones</h2>
                    <p style="font-size: 12px; color: #64748b; margin-top: 0;">Nota y reflexión de <b>ambos períodos</b> por estudiante y asignatura, con el <b>docente</b> que las emitió y quién las registró. La columna <b>Control</b> cruza lo guardado en la base de datos con la matrícula y marca lo que falta o está mal guardado.</p>
                    <fieldset>
                        <legend>Filtros</legend>
                        <div class="form-grid">
                            <div class="form-group"><label>Año Lectivo</label><select id="hist-anio" onchange="cargarHistorial()"></select></div>
                            <div class="form-group"><label>Nivel</label>
                                <select id="hist-nivel" onchange="cargarHistorial()">
                                    <option value="">Todos los niveles</option>
                                    <option value="Primero">Primero</option><option value="Segundo">Segundo</option><option value="Tercero">Tercero</option>
                                    <option value="Cuarto">Cuarto</option><option value="Quinto">Quinto</option><option value="Sexto">Sexto</option>
                                </select></div>
                            <div class="form-group"><label>Asignatura</label><select id="hist-materia" onchange="renderizarHistorial()"><option value="">Todas</option></select></div>
                            <div class="form-group" id="hist-docente-grupo"><label>Docente</label><select id="hist-docente" onchange="renderizarHistorial()"><option value="">Todos</option></select></div>
                            <div class="form-group"><label>Buscar estudiante</label><input type="text" id="hist-buscar" placeholder="Nombre..." oninput="renderizarHistorial()"></div>
                            <div class="form-group" style="justify-content: flex-end;"><label style="display: flex; align-items: center; gap: 6px; font-weight: normal;"><input type="checkbox" id="hist-alertas" style="width: auto;" onchange="renderizarHistorial()"> Solo con alertas</label></div>
                        </div>
                        <div id="hist-aviso-docente" style="display: none; font-size: 12px; color: #475569;"></div>
                    </fieldset>
                    <div id="hist-resumen" style="margin: 12px 0;"></div>
                    <div id="hist-tabla" style="overflow-x: auto;"><p style="color: #64748b;">Cargando historial...</p></div>
                `;
                principal.appendChild(sec);
            }
        }

        function inicializarHistorial() {
            const admin = esAdminActivo();
            inicializarSelectAnios('hist-anio', anioLectivoActivo);

            const selMat = document.getElementById('hist-materia');
            if (selMat && selMat.options.length <= 1) {
                ORDEN_MATERIAS.forEach(nombre => {
                    const o = document.createElement('option');
                    o.value = nombre; o.textContent = nombre;
                    selMat.appendChild(o);
                });
            }

            const grupoDoc = document.getElementById('hist-docente-grupo');
            const aviso = document.getElementById('hist-aviso-docente');
            if (grupoDoc) grupoDoc.style.display = admin ? '' : 'none';
            if (aviso) {
                aviso.style.display = admin ? 'none' : 'block';
                aviso.innerHTML = docenteNombreGlobal
                    ? `Mostrando las asignaturas de <b>${escapeHTML(docenteNombreGlobal)}</b>.`
                    : '⚠ No se encontró su ficha en el Directorio de Docentes (el correo con el que entró no está registrado como docente), por eso no se puede mostrar su historial. Avise al administrador.';
            }
            cargarHistorial();
        }

        async function cargarHistorial() {
            const cont = document.getElementById('hist-tabla');
            if (!cont) return;
            cont.innerHTML = '<p>Cargando historial...</p>';
            try {
                const anio = parseInt(document.getElementById('hist-anio').value, 10) || anioLectivoActivo;
                const nivel = document.getElementById('hist-nivel').value;

                let q = supabaseClient.from('estudiantes').select('*').eq('activo', true);
                if (nivel) q = q.eq('nivel', nivel);
                const { data: ests, error: errEst } = await q;
                if (errEst) throw errEst;

                let notas = [];
                const cedulas = (ests || []).map(e => e.cedula);
                if (cedulas.length) {
                    const { data: dn, error: errNotas } = await supabaseClient.from('notas').select('*').in('cedula_estudiante', cedulas);
                    if (errNotas) throw errNotas;
                    notas = dn || [];
                }

                // Fechas de los períodos (para saber si ya vencieron y, entonces, exigir el registro).
                let cfg = null;
                try { const r = await supabaseClient.from('configuracion_periodos').select('*').eq('id', 1).single(); cfg = r.data || null; } catch (_) { cfg = null; }

                // Docentes: nombre por correo (para mostrar quién registró) y lista para el filtro.
                if (!historialDocentes) {
                    try { const r = await supabaseClient.from('docentes').select('nombre, correo').order('nombre'); historialDocentes = r.data || []; }
                    catch (_) { historialDocentes = []; }
                }
                const selDoc = document.getElementById('hist-docente');
                if (selDoc && selDoc.options.length <= 1) {
                    historialDocentes.forEach(d => { const o = document.createElement('option'); o.value = d.nombre; o.textContent = d.nombre; selDoc.appendChild(o); });
                    const oSin = document.createElement('option'); oSin.value = '__sin__'; oSin.textContent = '(Materias sin docente asignado)'; selDoc.appendChild(oSin);
                }
                const correoANombre = new Map();
                historialDocentes.forEach(d => { if (d.correo) correoANombre.set(String(d.correo).trim().toLowerCase(), d.nombre); });

                historialCache = { anio, ests: ests || [], notasPorEst: agruparNotasPorEstudiante(notas), cfg, correoANombre };
                renderizarHistorial();
            } catch (e) {
                console.error('cargarHistorial:', e);
                cont.innerHTML = '<p style="color: red;">Error al cargar el historial: ' + escapeHTML(e.message || e) + '</p>';
            }
        }

        // Celda de UN período: nota, reflexión, quién la registró y alertas.
        function celdaHistorial(res, requiere, vencido, correoANombre) {
            const alertas = [];
            if (!res) {
                if (vencido) alertas.push('sin-registro');
                return { html: vencido ? '<span style="color: #b45309;">⚠ Sin registro</span>' : '<span style="color: #94a3b8;">Pendiente</span>', alertas };
            }
            const f = res.fila;
            const hayNota = f.promedio !== null && f.promedio !== undefined && f.promedio !== '';
            let h = '';
            if (hayNota) h += `<div><b style="font-size: 15px; color: var(--accent);">${escapeHTML(f.promedio)}</b></div>`;
            else { h += '<div style="color: #b45309;">⚠ Reflexión sin nota</div>'; alertas.push('sin-nota'); }

            if (f.comentario && String(f.comentario).trim()) {
                h += `<div style="margin-top: 3px; line-height: 1.35;">“${escapeHTML(f.comentario)}”</div>`;
                if (!requiere) h += '<div style="font-size: 10px; color: #94a3b8;">(esta asignatura no imprime reflexión en el informe)</div>';
            } else if (requiere) {
                h += '<div style="margin-top: 3px; color: #b45309;">⚠ Sin reflexión</div>';
                alertas.push('sin-reflexion');
            }

            if (f.modificado_por) {
                const quien = correoANombre.get(String(f.modificado_por).trim().toLowerCase()) || f.modificado_por;
                h += `<div style="margin-top: 3px; font-size: 10px; color: #64748b;">Registrado por ${escapeHTML(quien)}${f.modificado_en ? ' · ' + escapeHTML(textoFechaHora(f.modificado_en)) : ''}</div>`;
            }
            if (res.otroAnio) { h += `<div style="margin-top: 3px; font-size: 11px; color: #b45309;">⚠ Guardado en el año lectivo ${escapeHTML(f.anio_lectivo)}</div>`; alertas.push('otro-anio'); }
            if (res.materiaAntigua) { h += `<div style="margin-top: 3px; font-size: 11px; color: #b45309;">⚠ Materia guardada como “${escapeHTML(f.materia)}”</div>`; alertas.push('materia-antigua'); }
            return { html: h, alertas };
        }

        const TEXTO_ALERTA_HISTORIAL = {
            'sin-registro': 'sin registro (el período ya terminó)',
            'sin-reflexion': 'sin reflexión',
            'sin-nota': 'reflexión sin nota',
            'otro-anio': 'guardado en otro año lectivo',
            'materia-antigua': 'materia con nombre antiguo'
        };

        function renderizarHistorial() {
            const cont = document.getElementById('hist-tabla');
            const resumen = document.getElementById('hist-resumen');
            if (!cont || !historialCache) return;
            const { anio, ests, notasPorEst, cfg, correoANombre } = historialCache;

            const admin = esAdminActivo();
            const filtroMateria = document.getElementById('hist-materia').value;
            const filtroDocente = admin ? document.getElementById('hist-docente').value : '';
            const buscar = normalizarTexto(document.getElementById('hist-buscar').value);
            const soloAlertas = document.getElementById('hist-alertas').checked;
            const docenteSesion = normalizarTexto(docenteNombreGlobal);

            const hoy = new Date();
            const vencido = (periodo) => {
                if (anio < anioLectivoActivo) return true;
                if (anio > anioLectivoActivo) return false;
                const fin = cfg && (periodo === 'Primer Periodo' ? cfg.p1_fin : cfg.p2_fin);
                return !!fin && hoy > new Date(fin + 'T23:59:59');
            };
            const vencido1 = vencido('Primer Periodo'), vencido2 = vencido('Segundo Periodo');

            const ordenNivel = ['Primero', 'Segundo', 'Tercero', 'Cuarto', 'Quinto', 'Sexto'];
            const posMateria = (valor) => { const i = ORDEN_MATERIAS.findIndex(n => normalizarTexto(n) === claveMateria(valor)); return i === -1 ? 999 : i; };
            const estsOrdenados = [...ests].sort((a, b) => (ordenNivel.indexOf(a.nivel) - ordenNivel.indexOf(b.nivel)) || String(a.nombre).localeCompare(String(b.nombre), 'es'));

            const cuenta = { filas: 0, completas: 0, conAlertas: 0 };
            const porTipo = {};
            let filasHtml = '';

            estsOrdenados.forEach(est => {
                if (buscar && !normalizarTexto(est.nombre).includes(buscar)) return;
                const lista = notasPorEst.get(String(est.cedula)) || [];

                // Materias a revisar = las de la matrícula + cualquiera que tenga notas guardadas.
                const universo = new Map();
                materiasDelEstudiante(est).forEach(v => universo.set(claveMateria(v), { valor: v, enMatricula: true }));
                lista.forEach(n => {
                    const k = claveMateria(n.materia);
                    if (!universo.has(k)) universo.set(k, { valor: valorMateriaCanonico(nombreLimpioMateria(n.materia)), enMatricula: false });
                });

                [...universo.values()].sort((a, b) => posMateria(a.valor) - posMateria(b.valor)).forEach(m => {
                    const nombre = nombreLimpioMateria(m.valor);
                    if (filtroMateria && claveMateria(filtroMateria) !== claveMateria(nombre)) return;

                    const docente = docenteDeMateria(est, m.valor);
                    if (!admin) {
                        if (!docenteSesion || normalizarTexto(docente) !== docenteSesion) return;
                    } else if (filtroDocente === '__sin__') {
                        if (docente) return;
                    } else if (filtroDocente && normalizarTexto(docente) !== normalizarTexto(filtroDocente)) {
                        return;
                    }

                    const requiere = materiaRequiereReflexion(nombre);
                    const c1 = celdaHistorial(resolverNota(lista, m.valor, 'Primer Periodo', anio), requiere, vencido1, correoANombre);
                    const c2 = celdaHistorial(resolverNota(lista, m.valor, 'Segundo Periodo', anio), requiere, vencido2, correoANombre);

                    const alertas = [];
                    c1.alertas.forEach(a => alertas.push({ per: '1.º', tipo: a }));
                    c2.alertas.forEach(a => alertas.push({ per: '2.º', tipo: a }));
                    if (!docente) alertas.push({ per: '', tipo: 'sin-docente' });
                    if (!m.enMatricula) alertas.push({ per: '', tipo: 'fuera-matricula' });

                    if (soloAlertas && alertas.length === 0) return;

                    cuenta.filas++;
                    if (alertas.length) cuenta.conAlertas++; else cuenta.completas++;
                    alertas.forEach(a => { porTipo[a.tipo] = (porTipo[a.tipo] || 0) + 1; });

                    const textoControl = alertas.length
                        ? alertas.map(a => {
                            const t = a.tipo === 'sin-docente' ? 'sin docente asignado en la matrícula'
                                : a.tipo === 'fuera-matricula' ? 'tiene notas pero la materia ya no está en la matrícula'
                                : `${a.per} período: ${TEXTO_ALERTA_HISTORIAL[a.tipo]}`;
                            return `<div style="color: #b45309; margin-bottom: 2px;">⚠ ${escapeHTML(t)}</div>`;
                        }).join('')
                        : '<span style="color: #166534; font-weight: bold;">✔ Al día</span>';

                    filasHtml += `
                        <tr${alertas.length ? ' style="background: #fffdf5;"' : ''}>
                            <td style="text-align: left; white-space: normal; min-width: 150px;"><b>${escapeHTML(est.nombre)}</b><br><small>${escapeHTML(est.nivel)}</small></td>
                            <td style="white-space: normal;">${escapeHTML(nombre)}</td>
                            <td style="white-space: normal; min-width: 120px;">${docente ? escapeHTML(docente) : '<span style="color: #b45309;">⚠ Sin docente</span>'}</td>
                            <td style="text-align: left; white-space: normal; min-width: 230px;">${c1.html}</td>
                            <td style="text-align: left; white-space: normal; min-width: 230px;">${c2.html}</td>
                            <td style="text-align: left; white-space: normal; min-width: 170px; font-size: 11px;">${textoControl}</td>
                        </tr>`;
                });
            });

            const tarjeta = (titulo, valor, color) => `<div style="background: #fff; border: 1px solid var(--border); border-radius: 8px; padding: 8px 14px; min-width: 120px; text-align: center;"><div style="font-size: 11px; color: #64748b;">${titulo}</div><div style="font-size: 20px; font-weight: bold; color: ${color};">${valor}</div></div>`;
            resumen.innerHTML = `<div style="display: flex; flex-wrap: wrap; gap: 10px;">
                ${tarjeta('Asignaturas revisadas', cuenta.filas, '#1e293b')}
                ${tarjeta('Al día', cuenta.completas, '#166534')}
                ${tarjeta('Con alertas', cuenta.conAlertas, cuenta.conAlertas ? '#b45309' : '#166534')}
                ${tarjeta('Sin reflexión', porTipo['sin-reflexion'] || 0, '#b45309')}
                ${tarjeta('Sin registro', porTipo['sin-registro'] || 0, '#b45309')}
                ${tarjeta('Otro año / nombre antiguo', (porTipo['otro-anio'] || 0) + (porTipo['materia-antigua'] || 0), '#b45309')}
                ${tarjeta('Sin docente', porTipo['sin-docente'] || 0, '#b45309')}
            </div>`;

            cont.innerHTML = filasHtml
                ? `<table class="data-table" style="display: table; width: 100%;">
                        <thead><tr>
                            <th>Estudiante</th><th>Asignatura</th><th>Docente</th>
                            <th>Primer Periodo</th><th>Segundo Periodo</th><th>Control</th>
                        </tr></thead>
                        <tbody>${filasHtml}</tbody>
                   </table>`
                : '<p style="color: #64748b; text-align: center;">No hay registros que coincidan con los filtros.</p>';
        }

        inyectarPestanaHistorial();
