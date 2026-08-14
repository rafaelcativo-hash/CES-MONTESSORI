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

        // Exporta cualquiera de los documentos imprimibles (informe, lista oficial,
        // ficha de matrícula) como un archivo .doc editable en Microsoft Word,
        // conservando el formato visual (incluye la tipografía Century Gothic).
        function exportarComoWord(elementId, nombreArchivoBase) {
            const contenido = document.getElementById(elementId);
            if (!contenido) {
                alert('No hay contenido generado para exportar todavía.');
                return;
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
                .encabezado-informe-full { width: 18cm; margin: 0 0 4px 0; text-align: center; }
                .encabezado-informe-full img { width: 18cm; height: auto; }
                h3, h4 { color: #1e293b; }
            `;

            const htmlCompleto = `
                <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
                <head>
                    <meta charset='utf-8'>
                    <title>${nombreArchivoBase}</title>
                    <!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom><w:DoNotOptimizeForBrowser/></w:WordDocument></xml><![endif]-->
                    <style>${estilosWord}</style>
                </head>
                <body>${contenido.innerHTML}</body>
                </html>
            `;

            const blob = new Blob(['\ufeff', htmlCompleto], { type: 'application/msword' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `${nombreArchivoBase}.doc`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
        }

        // Calcula, consultando la matrícula real (solo estudiantes activos),
        // el conjunto de materias que un docente específico imparte de verdad.
        async function obtenerCargaRealDocente(nombreDocente) {
            const materiasPermitidas = new Set();
            if (!nombreDocente) return materiasPermitidas;

            const { data: estudiantes } = await supabaseClient.from('estudiantes').select('*').eq('activo', true);
            if (!estudiantes) return materiasPermitidas;

            estudiantes.forEach(est => {
                Object.entries(CAMPO_DOCENTE_POR_MATERIA).forEach(([materia, campo]) => {
                    if (est[campo] && est[campo] === nombreDocente) materiasPermitidas.add(materia);
                });
                if (est.instrumento_principal && est.docente_asignado === nombreDocente) {
                    materiasPermitidas.add(est.instrumento_principal);
                }
                if (est.instrumento_segundo && est.instrumento_segundo !== 'Ninguno' && est.docente_segundo === nombreDocente) {
                    materiasPermitidas.add(est.instrumento_segundo);
                }
            });

            return materiasPermitidas;
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
                // solo puede entrar a "Calificar" siempre.
                // A "mimatricula" (Editar Matrícula limitada) solo puede
                // entrar si además es docente académico (mismo criterio que
                // se usa para mostrar/ocultar el botón en verificarRolUsuario).
                const esAcademico = docenteTipoActual === 'academico';
                const tabsPermitidos = esAcademico ? ['calificar', 'mimatricula'] : ['calificar'];
                if (!tabsPermitidos.includes(idSeccion)) {
                    idSeccion = 'calificar';
                }
            }
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

            const { data: roleData } = await supabaseClient
                .from('user_roles')
                .select('role')
                .eq('email', email)
                .maybeSingle();

            if (roleData && roleData.role) {
                usuarioRolActual = roleData.role.toLowerCase();
            } else {
                usuarioRolActual = 'docente';
            }

            const { data: docData } = await supabaseClient
                .from('docentes')
                .select('especialidad, nombre, tipo_docente, ciclo_asignado')
                .eq('correo', email)
                .maybeSingle();

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
            if (usuarioRolActual === 'admin' && modoVistaDocente) {
                badge.innerText = `Rol: ADMIN — Viendo como Docente${docenteEspecialidadGlobal ? ' ('+docenteEspecialidadGlobal+')' : ''}`;
            } else {
                badge.innerText = `Rol: ${usuarioRolActual.toUpperCase()}${docenteEspecialidadGlobal ? ' ('+docenteEspecialidadGlobal+')' : ''}`;
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

            // El interruptor solo aparece para un administrador real que
            // ADEMÁS tiene su propio registro de docente académico (correo
            // coincide en la tabla "docentes"). Así puede alternar entre
            // gestionar todo el sistema y ver/editar únicamente su propia
            // carga académica, sin cerrar sesión.
            const btnAlternar = document.getElementById('btn-alternar-vista');
            if (btnAlternar) {
                if (usuarioRolActual === 'admin' && docenteTipoActual === 'academico') {
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
                for (let opt of selectMateria.options) {
                    if (!opt.value || opt.disabled) continue;
                    const nombreMateria = nombreMateriaLimpio(opt.value);
                    const permitirMateria = materiasReales.has(nombreMateria);
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
                if (materia === 'Taller de Percusión') valorDefecto = 'Luis De La O Jimenez';
                if (materia === 'Danza') valorDefecto = 'Vanesa De La O Jimenez';
                if (materia === 'Artes Plásticas') valorDefecto = 'Mirta Castro';
                if (materia === 'Inglés') valorDefecto = 'Ulises';
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
                        <td>${est.cedula}</td>
                        <td style="text-align: left;"><b>${est.nombre}</b></td>
                        <td><button type="button" class="warning-btn" style="padding: 4px 10px; font-size: 11px;" onclick="abrirEdicionMiMatricula('${est.cedula}')">Editar Datos</button></td>
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
                        <td>${est.cedula}</td>
                        <td style="text-align: left;"><b>${est.nombre}</b></td>
                        <td>${est.nivel}</td>
                        <td><span style="padding: 3px 8px; border-radius: 4px; font-size: 11px; background: ${estaOculto ? '#fef3c7; color: #92400e;' : '#dcfce7; color: #166534;'}">${estaOculto ? 'OCULTO' : 'ACTIVO'}</span></td>
                        <td style="white-space: nowrap;">
                            <button type="button" class="warning-btn" style="padding: 4px 10px; font-size: 11px;" onclick="cargarDatosEstudianteEdicion('${est.cedula}')">Editar</button>
                            <button type="button" class="${estaOculto ? 'success-btn' : 'warning-btn'}" style="padding: 4px 10px; font-size: 11px;" onclick="alternarVisibilidadEstudiante('${est.cedula}', ${estaOculto})">${estaOculto ? 'Reactivar' : 'Ocultar'}</button>
                            <button type="button" class="danger-btn" onclick="eliminarEstudiantePermanente('${est.cedula}', '${(est.nombre || '').replace(/'/g, "\\'")}')">Eliminar</button>
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

            await supabaseClient.from('notas').delete().eq('cedula_estudiante', cedula);
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
            document.getElementById('mat-docente-acad').value = data.docente_academico || '';
            
            if (document.getElementById('mat-doc-solfeo')) document.getElementById('mat-doc-solfeo').value = data.docente_solfeo || 'Rafael Cativo Romero';
            if (document.getElementById('mat-doc-percursion')) {
                const noLlevaPercusion = data.docente_percursion === 'No lleva';
                document.getElementById('mat-no-percusion').checked = noLlevaPercusion;
                document.getElementById('mat-doc-percursion').disabled = noLlevaPercusion;
                document.getElementById('mat-doc-percursion').value = noLlevaPercusion ? 'Luis De La O Jimenez' : (data.docente_percursion || 'Luis De La O Jimenez');
            }
            if (document.getElementById('mat-doc-danza')) document.getElementById('mat-doc-danza').value = data.docente_danza || 'Vanesa De La O Jimenez';
            if (document.getElementById('mat-doc-plasticas')) document.getElementById('mat-doc-plasticas').value = data.docente_plasticas || 'Mirta Castro';
            if (document.getElementById('mat-doc-ingles')) document.getElementById('mat-doc-ingles').value = data.docente_ingles || 'Ulises';
            if (document.getElementById('mat-doc-edufi')) document.getElementById('mat-doc-edufi').value = data.docente_edufi || 'Santiago Jimenez';

            document.getElementById('mat-instr-principal').value = data.instrumento_principal || '';
            document.getElementById('mat-docente-asig').value = data.docente_asignado || '';
            document.getElementById('mat-instr-segundo').value = data.instrumento_segundo || 'Ninguno';
            document.getElementById('mat-docente-segundo').value = data.docente_segundo || 'Ninguno';
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

            generarVistaPreviaMatricula();
        }

        function limpiarFormularioMatricula() {
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
            document.getElementById('contenedor-vista-previa-matricula').style.display = 'none';
            cargarDocentesEnMatricula();
        }

        function confirmarYGuardarMatricula(e) {
            e.preventDefault();
            if (confirm('¿Estás seguro que quieres realizar el cambio?')) {
                guardarOActualizarMatricula();
            }
        }

        async function guardarOActualizarMatricula() {
            const cedulaVal = document.getElementById('mat-cedula').value.trim();
            const nombreVal = document.getElementById('mat-nombre').value.trim();

            if (!cedulaVal || !nombreVal) {
                alert('El Nombre y la Cédula son obligatorios para la matrícula.');
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
                docente_percursion: document.getElementById('mat-no-percusion').checked ? 'No lleva' : (document.getElementById('mat-doc-percursion').value || ''),
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

            const { data: existing } = await supabaseClient.from('estudiantes').select('cedula').eq('cedula', cedulaVal).maybeSingle();

            let error = null;
            if (existing) {
                const res = await supabaseClient.from('estudiantes').update(datos).eq('cedula', cedulaVal);
                error = res.error;
            } else {
                const res = await supabaseClient.from('estudiantes').insert([datos]);
                error = res.error;
            }

            if (error) {
                mostrarMensaje('mat-msg', 'Error al guardar en Supabase: ' + error.message, false);
            } else {
                mostrarMensaje('mat-msg', '¡Matrícula rápida guardada con éxito! Puede completar el resto de datos cuando guste.', true);
                cargarSelectorEstudiantesEdicion();
                cargarTablaEstudiantesNivel();
                generarVistaPreviaMatricula();
            }
        }

        function generarVistaPreviaMatricula() {
            const anioLectivo = document.getElementById('filtro-anio-lectivo').value;
            const nombre = document.getElementById('mat-nombre').value;
            const cedula = document.getElementById('mat-cedula').value;
            const fnac = document.getElementById('mat-fnac').value;
            const lugarNac = document.getElementById('mat-lugar-nac').value;
            const fechaIngreso = document.getElementById('mat-fecha-ingreso').value;
            const institucionProcedencia = document.getElementById('mat-institucion-procedencia').value;
            const edadExactaTexto = document.getElementById('edad-resultado').innerText;

            // CORREGIDO: Toma el nivel real del formulario de matrícula de forma independiente
            const nivel = document.getElementById('mat-nivel').value;

            const docenteAcad = document.getElementById('mat-docente-acad').value;
            const docSolfeo = document.getElementById('mat-doc-solfeo').value;
            const docPerc = document.getElementById('mat-doc-percursion').value;
            const docDanza = document.getElementById('mat-doc-danza').value;
            const docPlast = document.getElementById('mat-doc-plasticas').value;
            const docIngles = document.getElementById('mat-doc-ingles').value;
            const docEdufi = document.getElementById('mat-doc-edufi').value;
            const instr = document.getElementById('mat-instr-principal').value;
            const docenteInstr = document.getElementById('mat-docente-asig').value;
            const instrSegundo = document.getElementById('mat-instr-segundo').value;
            const docenteSegundo = document.getElementById('mat-docente-segundo').value;
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
            const fotoUrl = document.getElementById('mat-foto-url').value;

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
                        <button type="button" class="warning-btn" onclick="exportarComoWord('preview-matricula-impresion', 'Ficha_Matricula_${cedula}')">Guardar en Word (Editable)</button>
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
                    `"${est.cedula || ''}"`,
                    `"${est.nombre || ''}"`,
                    `"${est.nivel || ''}"`,
                    `"${est.activo === false ? 'Oculto' : 'Activo'}"`,
                    `"${est.fecha_nacimiento || ''}"`,
                    `"${est.lugar_nacimiento || ''}"`,
                    `"${est.fecha_ingreso_ces || ''}"`,
                    `"${(est.institucion_procedencia || '').replace(/"/g, '""')}"`,
                    `"${est.docente_academico || ''}"`,
                    `"${est.docente_solfeo || ''}"`,
                    `"${est.docente_percursion || ''}"`,
                    `"${est.docente_danza || ''}"`,
                    `"${est.docente_plasticas || ''}"`,
                    `"${est.docente_ingles || ''}"`,
                    `"${est.docente_edufi || ''}"`,
                    `"${est.instrumento_principal || ''}"`,
                    `"${est.docente_asignado || ''}"`,
                    `"${est.instrumento_segundo || ''}"`,
                    `"${est.docente_segundo || ''}"`,
                    `"${est.provincia || ''}"`,
                    `"${est.canton || ''}"`,
                    `"${est.distrito || ''}"`,
                    `"${(est.direccion_detalles || '').replace(/"/g, '""')}"`,
                    `"${est.encargado1_nombre || ''}"`,
                    `"${est.encargado1_correo || ''}"`,
                    `"${est.encargado1_cel || ''}"`,
                    `"${(est.encargado1_profesion || '').replace(/"/g, '""')}"`,
                    `"${(est.encargado1_trabajo || '').replace(/"/g, '""')}"`,
                    `"${est.encargado2_nombre || ''}"`,
                    `"${est.encargado2_correo || ''}"`,
                    `"${est.encargado2_cel || ''}"`,
                    `"${(est.encargado2_profesion || '').replace(/"/g, '""')}"`,
                    `"${(est.encargado2_trabajo || '').replace(/"/g, '""')}"`,
                    `"${(est.observaciones || '').replace(/"/g, '""')}"`
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
                p1_inicio: document.getElementById('cfg-p1-inicio').value,
                p1_fin: document.getElementById('cfg-p1-fin').value,
                vac_inicio: document.getElementById('cfg-vac-inicio').value,
                vac_fin: document.getElementById('cfg-vac-fin').value,
                p2_inicio: document.getElementById('cfg-p2-inicio').value,
                p2_fin: document.getElementById('cfg-p2-fin').value,
                festival_fecha: document.getElementById('cfg-festival-fecha').value,
                festival_lugar: document.getElementById('cfg-festival-lugar').value,
                graduacion_fecha: document.getElementById('cfg-graduacion-fecha').value,
                graduacion_lugar: document.getElementById('cfg-graduacion-lugar').value
            };
            const { error } = await supabaseClient.from('configuracion_periodos').upsert([datos]);
            if (error) mostrarMensaje('cfg-msg', 'Error: ' + error.message, false);
            else mostrarMensaje('cfg-msg', '¡Configuración guardada con éxito!', true);
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
                        <td style="text-align: left;"><b>${doc.nombre}</b></td>
                        <td><span style="padding: 3px 8px; border-radius: 4px; font-size: 11px; background: ${doc.tipo_docente === 'academico' ? '#e0f2fe; color: #0369a1;' : '#fef3c7; color: #92400e;'}">${doc.tipo_docente.toUpperCase()}</span></td>
                        <td>${doc.especialidad}</td>
                        <td>${doc.correo}</td>
                        <td>${doc.telefono}</td>
                        <td>
                            <button class="warning-btn" style="padding: 4px 10px; font-size: 11px;" onclick="cargarDocenteParaEdicion('${doc.id}', '${doc.nombre.replace(/'/g, "\\'")}', '${doc.correo.replace(/'/g, "\\'")}', '${doc.telefono.replace(/'/g, "\\'")}', '${doc.especialidad.replace(/'/g, "\\'")}', '${doc.tipo_docente}', '${doc.ciclo_asignado || 'Ambos Ciclos'}')">Editar</button>
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
                let countEst = 0;
                let detalleGrupos = [];
                let materiasReales = new Set();

                if (estudiantes) {
                    estudiantes.forEach(est => {
                        let match = false;

                        Object.entries(CAMPO_DOCENTE_POR_MATERIA).forEach(([materia, campo]) => {
                            if (est[campo] && est[campo] === nom) {
                                materiasReales.add(materia);
                                match = true;
                            }
                        });
                        if (est.instrumento_principal && est.docente_asignado === nom) {
                            materiasReales.add(est.instrumento_principal);
                            match = true;
                        }
                        if (est.instrumento_segundo && est.instrumento_segundo !== 'Ninguno' && est.docente_segundo === nom) {
                            materiasReales.add(est.instrumento_segundo);
                            match = true;
                        }

                        if (match) {
                            countEst++;
                            if (!detalleGrupos.includes(est.nivel)) {
                                detalleGrupos.push(est.nivel);
                            }
                        }
                    });
                }

                const listaMateriasStr = materiasReales.size > 0 ? Array.from(materiasReales).join(', ') : '<span style="color:#991b1b;">Sin carga real asignada en Matrícula</span>';

                html += `
                    <tr>
                        <td style="text-align: left;"><b>${doc.nombre}</b><br><small>${doc.correo}</small></td>
                        <td><span style="padding: 3px 8px; border-radius: 4px; font-size: 11px; background: ${doc.tipo_docente === 'academico' ? '#e0f2fe; color: #0369a1;' : '#fef3c7; color: #92400e;'}">${doc.tipo_docente.toUpperCase()}</span></td>
                        <td>${doc.especialidad}</td>
                        <td style="text-align: left;">${listaMateriasStr}</td>
                        <td><b>${countEst} estudiantes</b><br><small>Niveles: ${detalleGrupos.length > 0 ? detalleGrupos.join(', ') : 'Ninguno asignado'}</small></td>
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
                        <td style="text-align: left;"><b>${item.email}</b></td>
                        <td><span style="padding: 3px 8px; border-radius: 4px; font-size: 11px; background: ${item.role === 'admin' ? '#dcfce7; color: #166534;' : '#fef3c7; color: #92400e;'}">${item.role.toUpperCase()}</span></td>
                        <td>
                            <button class="danger-btn" onclick="eliminarRolUsuario('${item.email}')">Eliminar Rol</button>
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

            const email = document.getElementById('rol-email-input').value.trim();
            const role = document.getElementById('rol-select-input').value;

            const { error } = await supabaseClient.from('user_roles').upsert([{ email, role }], { onConflict: 'email' });

            if (error) {
                mostrarMensaje('rol-msg', 'Error al guardar el rol: ' + error.message, false);
            } else {
                mostrarMensaje('rol-msg', `¡Rol '${role}' asignado exitosamente a ${email}!`, true);
                document.getElementById('form-asignar-rol').reset();
                cargarTablaRolesUsuarios();
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
                nombre: document.getElementById('doc-nombre').value,
                correo: document.getElementById('doc-correo').value,
                telefono: document.getElementById('doc-tel').value,
                especialidad: document.getElementById('doc-esp').value,
                tipo_docente: document.getElementById('doc-tipo').value,
                ciclo_asignado: document.getElementById('doc-ciclo').value
            };

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
            const fnac = new Date(fechaNacVal);
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
                    { id: 'cotidiano', label: 'Cotidiano', peso: 0.60 },
                    { id: 'autorregulacion', label: 'Autorregulación', peso: 0.15 }
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
            const { data: notas, error: errNotas } = await supabaseClient.from('notas').select('*').eq('periodo', periodo).eq('materia', materia).eq('anio_lectivo', anioLectivoActivo);

            if (errEst) {
                contenedor.innerHTML = '<p style="color: red;">Error al cargar estudiantes: ' + errEst.message + '</p>';
                return;
            }

            let estudiantes = estudiantesRaw || [];
            if (instrumentoEspecifico && estudiantes.length > 0) {
                estudiantes = estudiantes.filter(est => est.instrumento_principal === instrumentoEspecifico || est.instrumento_segundo === instrumentoEspecifico);
            }

            // Excluye estudiantes marcados como "No lleva" esta materia (ej. Taller
            // de Percusión), para que no aparezcan en la planilla ni se les genere
            // nota, y así tampoco aparezcan en su Informe al Hogar.
            const campoMateriaActual = CAMPO_DOCENTE_POR_MATERIA[nombreMateriaLimpio(materia)];
            if (campoMateriaActual) {
                estudiantes = estudiantes.filter(est => est[campoMateriaActual] !== 'No lleva');
            }

            if (estudiantes.length === 0) {
                contenedor.innerHTML = `<p style="text-align: center; color: #991b1b;">No hay estudiantes matriculados${instrumentoEspecifico ? ` con el instrumento ${instrumentoEspecifico}` : ''} en el nivel ${nivel}.</p>`;
                return;
            }

            const rubros = obtenerRubrosMateria(materia);
            const esAcademicaPura = materia.includes('Español') || materia.includes('Matemáticas') || materia.includes('Ciencias') || materia.includes('Estudios Sociales');
            const esSolfeoPercusion = materia.includes('Solfeo') || materia.includes('Taller de Percusión');
            const llevaComentario = !esSolfeoPercusion && !esAcademicaPura;
            const esConducta = materia.includes('Conducta');

            let html = `
                <h3 style="color: var(--primary); margin-top: 20px;">Planilla de Calificación: ${nivel} - ${materia} (${periodo})${instrumentoEspecifico ? ` [Instrumento: ${instrumentoEspecifico}]` : ''}</h3>
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>Estudiante / Asignación</th>
            `;

            rubros.forEach(r => {
                html += `<th>${r.label}<br><span style="font-size:10px; font-weight:normal;">(${Math.round(r.peso * 100)}%)</span></th>`;
            });

            html += `
                            <th>Nota Final</th>
                            <th>Reflexiones Docentes</th>
                            <th>Acción</th>
                        </tr>
                    </thead>
                    <tbody>
            `;

            estudiantes.forEach(est => {
                const notaReg = notas ? notas.find(n => n.cedula_estudiante === est.cedula) : null;
                const promedioGuardado = notaReg ? notaReg.promedio : '-';
                const comentarioGuardado = notaReg && notaReg.comentario ? notaReg.comentario : '';

                html += `
                    <tr>
                        <td style="text-align: left;"><b>${est.nombre}</b><br><small>Inst. Princ: ${est.instrumento_principal || 'N/A'} | Inst. 2do: ${est.instrumento_segundo || 'Ninguno'}</small></td>
                `;

                rubros.forEach(r => {
                    html += `<td><input type="number" step="0.01" min="0" max="100" class="input-rubro-${est.cedula}" data-peso="${r.peso}" placeholder="0-100" style="width: 70px; text-align: center;" oninput="calcularNotaFinalEstudiante('${est.cedula}')"></td>`;
                });

                html += `
                        <td><b id="lbl-final-${est.cedula}" style="color: var(--accent); font-size: 13px;">${promedioGuardado}</b></td>
                        <td>
                `;

                if (llevaComentario) {
                    html += `<input type="text" id="comentario-est-${est.cedula}" value="${escapeHTML(comentarioGuardado)}" placeholder="${esConducta ? 'Reflexión docente obligatoria...' : 'Reflexión docente opcional...'}" style="width: 200px;" ${esConducta ? 'required' : ''}>`;
                } else {
                    html += `<span style="color: #94a3b8; font-size: 11px; font-style: italic;">No requerido</span>`;
                }

                html += `
                        </td>
                        <td>
                            <button class="action-btn" style="padding: 6px 12px; font-size: 12px;" onclick="guardarNotaComponentes('${est.cedula}', '${materia}', '${periodo}', ${esConducta})">Guardar</button>
                        </td>
                    </tr>
                `;
            });

            html += `</tbody></table>`;
            contenedor.innerHTML = html;
        }

        function calcularNotaFinalEstudiante(cedula) {
            const inputs = document.querySelectorAll(`.input-rubro-${cedula}`);
            let total = 0;

            inputs.forEach(input => {
                const val = parseFloat(input.value);
                const peso = parseFloat(input.getAttribute('data-peso'));
                if (!isNaN(val)) {
                    total += val * peso;
                }
            });

            const lblFinal = document.getElementById(`lbl-final-${cedula}`);
            if (lblFinal) {
                lblFinal.innerText = Number(total.toFixed(2));
            }
        }

        async function guardarNotaComponentes(cedula, materia, periodo, esConducta) {
            const lblFinal = document.getElementById(`lbl-final-${cedula}`);
            const promedioFinal = parseFloat(lblFinal.innerText);
            const comentarioInput = document.getElementById(`comentario-est-${cedula}`);
            const comentario = comentarioInput ? comentarioInput.value.trim() : '';

            if (isNaN(promedioFinal)) {
                alert('Por favor ingrese las notas en los componentes antes de guardar.');
                return;
            }

            if (esConducta && !comentario) {
                alert('La reflexión docente en Conducta es obligatoria para el informe al hogar.');
                comentarioInput.focus();
                return;
            }

            const datos = { 
                cedula_estudiante: String(cedula), 
                materia: String(materia), 
                periodo: String(periodo), 
                anio_lectivo: anioLectivoActivo,
                promedio: Number(promedioFinal),
                comentario: String(comentario) 
            };

            const { error } = await supabaseClient.from('notas').upsert([datos], { onConflict: 'cedula_estudiante,materia,periodo,anio_lectivo' });
            if (error) {
                alert('Error al guardar: ' + error.message);
            } else {
                alert(`¡Calificación guardada con éxito para la cédula ${cedula} (Año lectivo ${anioLectivoActivo})!`);
            }
        }

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
                ${materiasNoReconocidas.size > 0 ? `<p style="color: #92400e;"><b>Materias del Excel no reconocidas (se ignoraron):</b> ${Array.from(materiasNoReconocidas).join(', ')}</p>` : ''}
                <table class="data-table">
                    <thead><tr><th>Cédula</th><th style="text-align:left;">Nombre (Excel)</th><th>Estado</th><th>Materias a importar</th></tr></thead>
                    <tbody>
            `;

            datosParaImportar.forEach(d => {
                const estadoTxt = !d.encontrado ? '<span style="color:#991b1b;">NO ENCONTRADO</span>' : (d.activo ? '<span style="color:#166534;">OK</span>' : '<span style="color:#92400e;">OCULTO</span>');
                html += `<tr><td>${d.cedula}</td><td style="text-align:left;">${d.nombreExcel}</td><td>${estadoTxt}</td><td style="text-align:left; font-size:12px;">${d.materias.map(m => nombreMateriaLimpio(m.materia)).join(', ')}</td></tr>`;
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
                        comentario: m.comentario
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

            const { data: estudiantes } = await supabaseClient.from('estudiantes').select('*').eq('nivel', nivel).eq('activo', true);
            const { data: notas } = await supabaseClient.from('notas').select('*').eq('anio_lectivo', anio);

            if (!estudiantes || estudiantes.length === 0) {
                contenedor.innerHTML = `<p>No hay estudiantes matriculados en ${nivel}.</p>`;
                return;
            }

            let materiasSet = new Set();
            if (notas) {
                notas.forEach(n => {
                    const estMatch = estudiantes.find(e => e.cedula === n.cedula_estudiante);
                    if (estMatch) materiasSet.add(n.materia);
                });
            }

            const listaMaterias = Array.from(materiasSet);

            let html = `<h3>Registro Histórico - Nivel: ${nivel} - Año Lectivo: ${anio}</h3>`;
            html += `<table class="data-table"><thead><tr><th>Estudiante</th><th>Cédula</th><th>Profesores / Inst</th>`;
            
            if (listaMaterias.length === 0) {
                html += `<th>Sin materias registradas aún</th></tr></thead><tbody>`;
            } else {
                listaMaterias.forEach(mat => {
                    html += `<th>${mat}<br><span style="font-size:10px; font-weight:normal;">1°P | 2°P | Final (50%-50%)</span></th>`;
                });
                html += `</tr></thead><tbody>`;
            }

            estudiantes.forEach(est => {
                const notasEst = notas ? notas.filter(n => n.cedula_estudiante === est.cedula) : [];
                html += `<tr><td><b>${est.nombre}</b></td><td>${est.cedula}</td><td><small>Acad: ${est.docente_academico || 'N/A'}<br>Solfeo: ${est.docente_solfeo || 'N/A'}<br>Percusión: ${est.docente_percursion || 'N/A'}<br>Inst: ${est.instrumento_principal || 'N/A'}</small></td>`;
                
                if (listaMaterias.length > 0) {
                    listaMaterias.forEach(mat => {
                        const n1 = notasEst.find(n => n.materia === mat && n.periodo === 'Primer Periodo');
                        const n2 = notasEst.find(n => n.materia === mat && n.periodo === 'Segundo Periodo');
                        const p1 = n1 ? n1.promedio : '-';
                        const p2 = n2 ? n2.promedio : '-';
                        let finalStr = '-';
                        if (n1 && n2) {
                            finalStr = Number(((n1.promedio * 0.5) + (n2.promedio * 0.5)).toFixed(2));
                        }
                        html += `<td>1°P: ${p1}<br>2°P: ${p2}<br><b>Final: ${finalStr}</b></td>`;
                    });
                }
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
            const docenteSeleccionado = estData.docente_academico || '[Sin asignar]';

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
            materiasUnicas.forEach(mat => { mapaMateriaPorNombre[nombreMateriaLimpio(mat)] = mat; });

            const filasBasicas = ordenBasicas.filter(n => mapaMateriaPorNombre[n]).map(n => mapaMateriaPorNombre[n]);
            const filasEspeciales = ordenEspeciales.filter(n => mapaMateriaPorNombre[n]).map(n => mapaMateriaPorNombre[n]);

            const coloresElegantes = [
                { border: '#2563eb', bg: '#eff6ff', textHeader: '#1e40af' },
                { border: '#7c3aed', bg: '#f5f3ff', textHeader: '#5b21b6' },
                { border: '#0d9488', bg: '#f0fdfa', textHeader: '#115e59' },
                { border: '#d97706', bg: '#fffbeb', textHeader: '#92400e' },
                { border: '#db2777', bg: '#fdf2f8', textHeader: '#9d174d' },
                { border: '#4f46e5', bg: '#eef2ff', textHeader: '#3730a3' }
            ];

            const construirFilaMateria = (mat, indexGlobal) => {
                const notaP1 = notas.find(n => n.materia === mat && n.periodo === 'Primer Periodo');
                const notaP2 = notas.find(n => n.materia === mat && n.periodo === 'Segundo Periodo');

                const valP1 = notaP1 ? notaP1.promedio : '-';
                const valP2 = notaP2 ? notaP2.promedio : '-';

                let valAnual = '-';
                let estado = 'Pendiente';

                if (notaP1 && notaP2) {
                    valAnual = Number(((notaP1.promedio * 0.5) + (notaP2.promedio * 0.5)).toFixed(2));
                    if (notaP1.promedio >= 65 && notaP2.promedio >= 65 && valAnual >= 65) {
                        estado = '<span style="color: #166534; font-weight: bold;">Aprobado</span>';
                    } else {
                        estado = '<span style="color: #991b1b; font-weight: bold;">Reprobado</span>';
                    }
                } else if (periodoSel === 'Primer Periodo' && notaP1) {
                    valAnual = valP1;
                    estado = valP1 >= 65 ? '<span style="color: #166534; font-weight: bold;">Aprobado (Parcial)</span>' : '<span style="color: #991b1b; font-weight: bold;">Reprobado (Parcial)</span>';
                }

                const notaMatPeriodo = periodoSel === 'Primer Periodo' ? notaP1 : notaP2;
                const nombreMostrado = nombreParaMostrar(nombreMateriaLimpio(mat));

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
                    const nombreMateriaLimpia = nombreMateriaLimpio(mat);
                    let docenteCargo = 'No asignado';
                    const campoDoc = CAMPO_DOCENTE_POR_MATERIA[nombreMateriaLimpia];

                    if (campoDoc) {
                        docenteCargo = estData[campoDoc] || 'No asignado';
                    } else if (INSTRUMENTOS_INDIVIDUALES.includes(nombreMateriaLimpia)) {
                        if (estData.instrumento_principal === nombreMateriaLimpia) {
                            docenteCargo = estData.docente_asignado || 'No asignado';
                        } else if (estData.instrumento_segundo === nombreMateriaLimpia) {
                            docenteCargo = estData.docente_segundo || 'No asignado';
                        }
                    }

                    const estiloColor = coloresElegantes[indexGlobal % coloresElegantes.length];

                    reflexionesDocentesHTML += `
                        <div class="reflexion-item" style="padding: 12px 15px; border-radius: 6px; border-left: 4px solid ${estiloColor.border}; border: 1px solid ${estiloColor.border}; background-color: ${estiloColor.bg}; margin-bottom: 10px;">
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px; font-size: 12px;">
                                <span style="font-weight: bold; color: ${estiloColor.textHeader}; text-transform: uppercase;">Materia / Área: ${nombreMostrado}</span>
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

            const esPrimerCiclo = ['Primero', 'Segundo', 'Tercero'].includes(estData.nivel);
            const imagenFirma = esPrimerCiclo ? 'informe%20firma%20jessica.jpeg' : 'informe%20firma%20vero.jpeg';

            contenedor.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; margin-top: 20px;" class="no-print">
                    <h3 style="margin: 0; color: var(--primary);">Vista Previa y Opciones de Informe al Hogar</h3>
                    <div style="display: flex; gap: 10px; flex-wrap: wrap;">
                        <button type="button" class="action-btn" onclick="window.print()">Imprimir en Físico</button>
                        <button type="button" class="warning-btn" onclick="exportarComoWord('plantilla-informe-oficial', 'Informe_${estData.cedula}')">Guardar en Word (Editable)</button>
                        <button type="button" class="success-btn" onclick="enviarInformeSimultaneo()">Enviar Informe a Encargados</button>
                    </div>
                </div>

                <div class="report-preview" id="plantilla-informe-oficial">
                    <div class="seccion-pagina-1">
                        <div class="encabezado-informe-full">
                            <img src="ces%20montessori%20encabezado.jpeg" alt="Encabezado del Informe">
                        </div>

                        <div style="text-align: center; margin-bottom: 6px;">
                            <p style="margin: 0; font-size: 15px; color: #000000; font-weight: bold; text-transform: uppercase;">Reporte de Calificaciones ${anioLectivoActivo}</p>
                            <p style="margin: 3px 0 0 0; font-size: 12px; color: #000000; font-weight: bold; text-transform: uppercase;">Dirección Regional de Heredia - Circuito Escolar 04</p>
                            <p style="margin: 3px 0 0 0; font-size: 12px; color: #000000; font-weight: bold; text-transform: uppercase;">Centro Educativo Shkénuk</p>
                        </div>

                        <div style="margin-bottom: 8px; font-size: 12px; background: #f8fafc; padding: 8px 10px; border-radius: 6px; border: 1px solid var(--border); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                            <b>Estudiante:</b> ${estData.nombre} &nbsp;&nbsp;|&nbsp;&nbsp; <b>Cédula:</b> ${estData.cedula} &nbsp;&nbsp;|&nbsp;&nbsp; <b>Nivel:</b> ${estData.nivel}
                        </div>

                        <div style="margin-bottom: 15px;">
                            <h4 style="color: var(--primary); margin: 0 0 6px 0; font-size: 13px;">Rendimiento Académico y Artístico Consolidado — ${tituloInformeHogar}</h4>
                            <table class="data-table">
                                <thead>
                                    <tr>
                                        <th>Materia / Asignatura</th>
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

                        <div style="text-align: center; margin-top: 20px; page-break-inside: avoid; break-inside: avoid;">
                            <img src="${imagenFirma}" alt="Firma Autorizada" style="max-width: 253px; height: auto; display: inline-block;">
                        </div>

                        <div class="cita-montessori cita-pie-pagina">
                            <p class="texto-cita">"La primera tarea de la educación es agitar la vida, pero dejarla libre para que se desarrolle"</p>
                            <p class="autor-cita">María Montessori</p>
                        </div>
                    </div>

                    <div class="salto-pagina-forzado" style="margin-top: 40px; border-top: 2px dashed #cbd5e1; padding-top: 30px;">
                        <div class="report-header" style="display: flex; align-items: center; justify-content: center; border-bottom: 2px solid var(--border); padding-bottom: 12px; margin-bottom: 20px;">
                            <div style="text-align: center;">
                                <h3 style="margin: 0; color: var(--primary); font-size: 18px; text-transform: uppercase;">Registro CES Montessori</h3>
                                <p style="margin: 3px 0 0 0; font-size: 13px; color: var(--accent); font-weight: bold;">Reflexiones Docentes • ${periodoSel}</p>
                            </div>
                        </div>

                        <div class="reflexiones-container">
                            ${reflexionesDocentesHTML}
                        </div>

                        <div class="cita-montessori">
                            <p class="texto-cita">"No hay nadie que lo sepa todo, ni nadie que no sepa nada. Entre todos sabemos todo"</p>
                            <p class="autor-cita">Paulo Freire</p>
                        </div>

                        <div style="text-align: center; margin-top: 25px;">
                            <img src="ces%20mano.png" alt="Cierre CES Montessori" style="max-width: 160px; height: auto; display: inline-block;">
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
            const nombreArchivo = `Informe_Hogar_${estData.nombre.replace(/\s+/g, '_')}_${periodoSel.replace(/\s+/g, '_')}.pdf`;

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
            const { data: estudiantes } = await supabaseClient.from('estudiantes').select('*').in('nivel', niveles).eq('activo', true);
            const { data: notas } = await supabaseClient.from('notas').select('*').eq('anio_lectivo', anioLectivoActivo);

            if (!estudiantes || estudiantes.length === 0) {
                contenedor.innerHTML = `<p>No se encontraron estudiantes matriculados en ${ciclo}.</p>`;
                return;
            }

            let html = `
                <h3>Listado de ${ciclo} con Instrumentos y Notas</h3>
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
                const notasEst = notas ? notas.filter(n => n.cedula_estudiante === est.cedula) : [];
                const materias = [...new Set(notasEst.map(n => n.materia))];

                if (materias.length === 0) {
                    html += `<tr><td>${est.cedula}</td><td><b>${est.nombre}</b><br><small>Acad: ${est.docente_academico || ''}</small></td><td>${est.nivel}</td><td colspan="5" style="color: #94a3b8; text-align: center;">Sin notas registradas todavía</td></tr>`;
                } else {
                    materias.forEach((mat, idx) => {
                        const notaP1 = notasEst.find(n => n.materia === mat && n.periodo === 'Primer Periodo');
                        const notaP2 = notasEst.find(n => n.materia === mat && n.periodo === 'Segundo Periodo');
                        const p1Val = notaP1 ? notaP1.promedio : null;
                        const p2Val = notaP2 ? notaP2.promedio : null;
                        
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
                                ${idx === 0 ? `<td rowspan="${materias.length}">${est.cedula}</td><td rowspan="${materias.length}"><b>${est.nombre}</b><br><small>Acad: ${est.docente_academico || 'N/A'}<br>Solfeo: ${est.docente_solfeo || 'N/A'}<br>Percusión: ${est.docente_percursion || 'N/A'}<br>Inst. Princ: ${est.instrumento_principal || 'N/A'}</small></td><td rowspan="${materias.length}">${est.nivel}</td>` : ''}
                                <td>${mat}</td>
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

            const { data: estudiantes } = await supabaseClient.from('estudiantes').select('*').eq('activo', true);
            const { data: notas } = await supabaseClient.from('notas').select('*').eq('anio_lectivo', anioLectivoActivo);

            if (!estudiantes || !notas) {
                if (msgSpan) msgSpan.innerText = 'No hay datos suficientes para procesar.';
                return;
            }

            const secuenciaNiveles = { 'Primero': 'Segundo', 'Segundo': 'Tercero', 'Tercero': 'Cuarto', 'Cuarto': 'Quinto', 'Quinto': 'Sexto', 'Sexto': 'Graduado' };
            let promovidosCount = 0;
            let registrosHistorial = [];

            for (const est of estudiantes) {
                const notasEst = notas.filter(n => n.cedula_estudiante === est.cedula);
                const materias = [...new Set(notasEst.map(n => n.materia))];
                if (materias.length === 0) continue;

                let pasaTodas = true;
                for (const mat of materias) {
                    const n1 = notasEst.find(n => n.materia === mat && n.periodo === 'Primer Periodo');
                    const n2 = notasEst.find(n => n.materia === mat && n.periodo === 'Segundo Periodo');
                    if (!n1 || !n2 || n1.promedio < 65 || n2.promedio < 65) {
                        pasaTodas = false;
                        break;
                    }
                }

                if (pasaTodas && est.nivel !== 'Graduado') {
                    const nuevoNivel = secuenciaNiveles[est.nivel];
                    if (nuevoNivel) {
                        await supabaseClient.from('estudiantes').update({ nivel: nuevoNivel }).eq('cedula', est.cedula);
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

            if (registrosHistorial.length > 0) {
                await supabaseClient.from('historial_promociones').insert(registrosHistorial);
            }

            const mensajeFinal = `¡Proceso finalizado para el Año Lectivo ${anioLectivoActivo}! Estudiantes promovidos: ${promovidosCount}. El detalle quedó guardado en el historial de promociones de ese año.`;
            document.querySelectorAll('#promocion-msg, #promocion-msg-matricula').forEach(el => el.innerText = mensajeFinal);

            cargarSelectorEstudiantesEdicion();
            cargarTablaEstudiantesNivel();

            if (confirm(`El proceso del Año Lectivo ${anioLectivoActivo} terminó.\n\n¿Desea avanzar el Año Lectivo Activo del sistema a ${anioLectivoActivo + 1} para comenzar a calificar el nuevo curso? (Los datos de ${anioLectivoActivo} y anteriores quedan guardados intactos)`)) {
                anioLectivoActivo = anioLectivoActivo + 1;
                await supabaseClient.from('configuracion_periodos').update({ anio_lectivo_activo: anioLectivoActivo }).eq('id', 1);
                const inputAnio = document.getElementById('cfg-anio-activo');
                if (inputAnio) inputAnio.value = anioLectivoActivo;
                const spanAnio = document.getElementById('span-anio-activo-matricula');
                if (spanAnio) spanAnio.textContent = anioLectivoActivo;
                alert(`El Año Lectivo Activo ahora es ${anioLectivoActivo}.`);
            }
        }

        async function verHistorialPromociones() {
            const contenedor = document.getElementById('contenedor-historial-promociones');
            if (!contenedor) return;

            const anioConsulta = prompt('¿De qué Año Lectivo desea ver el historial de promociones?', anioLectivoActivo);
            if (!anioConsulta) return;

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
                html += `<tr><td>${r.cedula_estudiante}</td><td style="text-align:left;">${r.nombre_estudiante}</td><td>${r.nivel_origen}</td><td>${r.nivel_destino}</td><td>${r.estado}</td></tr>`;
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

            const { data, error } = await supabaseClient.from('estudiantes').select('*').in('nivel', nivelesAConsultar).eq('activo', true);

            if (error) {
                contenedor.innerHTML = '<p style="color: red;">Error al cargar estudiantes: ' + error.message + '</p>';
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
                        <td style="text-align: center;">${est.cedula || ''}</td>
                        <td style="text-align: left;"><b>${est.nombre || ''}</b></td>
                        ${seleccion.includes('Ciclo') ? `<td>${est.nivel || ''}</td>` : ''}
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
                    <div style="width: 100%; margin-bottom: 2px; text-align: center;">
                        <img src="ces%20montessori%20encabezado.jpeg" alt="Encabezado del Informe" style="width: auto; max-width: 100%; height: auto; max-height: 140px; display: block; margin: 0 auto;">
                    </div>

                    <div style="text-align: center; margin-bottom: 20px;">
                        <p style="margin: 1px 0; font-size: 11px; color: #64748b;">Dirección Regional de Heredia • Circuito Escolar 04</p>
                        <p style="margin: 1px 0; font-size: 11px; color: #64748b;">Calle El Pedregal 40205, Heredia, Barva, El Carbonal • Tel: 2260-7806</p>
                        <p style="margin: 8px 0 0 0; font-size: 14px; color: var(--accent); font-weight: bold; text-transform: uppercase;">LISTA OFICIAL DE ESTUDIANTES • ${tituloCicloNivel}</p>
                    </div>

                    <div style="margin-bottom: 20px;">
                        <table class="data-table">
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
                    `"${est.cedula || ''}"`,
                    `"${est.nombre || ''}"`,
                    `"${est.nivel || ''}"`
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
                        <td style="text-align: left;"><b>${est.nombre || ''}</b></td>
                        <td>${est.nivel || ''}</td>
                        <td><input type="checkbox" style="width: 18px; height: 18px; cursor: pointer;" ${est.matricula_pagada ? 'checked' : ''} onchange="guardarEstadoPagoAnual(this, '${est.cedula}', 'matricula_pagada')"></td>
                        <td><input type="checkbox" style="width: 18px; height: 18px; cursor: pointer;" ${est.materiales_sem1_pagado ? 'checked' : ''} onchange="guardarEstadoPagoAnual(this, '${est.cedula}', 'materiales_sem1_pagado')"></td>
                        <td><input type="checkbox" style="width: 18px; height: 18px; cursor: pointer;" ${est.materiales_sem2_pagado ? 'checked' : ''} onchange="guardarEstadoPagoAnual(this, '${est.cedula}', 'materiales_sem2_pagado')"></td>
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
            const { error } = await supabaseClient.from('estudiantes').update({ [campo]: checkbox.checked }).eq('cedula', cedula);
            checkbox.disabled = false;
            if (error) {
                checkbox.checked = !checkbox.checked;
                alert('Error al guardar: ' + error.message);
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
                filas += `<tr><td style="text-align: left;"><b>${est.nombre || ''}</b></td><td>${est.nivel || ''}</td>`;
                MESES_FINANCIERO.forEach(m => {
                    const periodoMes = `${anio}-${m.num}`;
                    const registro = pagos ? pagos.find(p => p.cedula_estudiante === est.cedula && p.periodo_mes === periodoMes) : null;
                    const pagada = registro ? registro.mensualidad_pagada : false;
                    filas += `<td><input type="checkbox" style="width: 18px; height: 18px; cursor: pointer;" ${pagada ? 'checked' : ''} onchange="guardarMensualidad(this, '${est.cedula}', '${periodoMes}', ${anio})"></td>`;
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
            const { error } = await supabaseClient.from('control_financiero').upsert([datos], { onConflict: 'cedula_estudiante,periodo_mes' });
            checkbox.disabled = false;
            if (error) {
                checkbox.checked = !checkbox.checked;
                alert('Error al guardar: ' + error.message);
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
                ? morosos.map(e => `<tr><td style="text-align: left;">${e.nombre || ''}</td><td>${e.nivel || ''}</td></tr>`).join('')
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
                <table class="data-table" style="font-size: 10.5px; flex: 1;">
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
                        estudiante <b>${estData.nombre}</b> se encuentra al día con sus obligaciones financieras al corte de <b>${nombreMesCorte} de ${anio}</b>,
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
                        del estudiante <b>${estData.nombre}</b>, ya que estas nos permiten sostener la calidad académica, los materiales y el bienestar de toda
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
                    <button type="button" class="warning-btn" onclick="exportarComoWord('plantilla-reporte-financiero', 'Estado_Cuenta_${estData.nombre.replace(/\s+/g, '_')}')">Guardar en Word (Editable)</button>
                </div>

                <div class="report-preview" id="plantilla-reporte-financiero">
                    <div class="encabezado-informe-full">
                        <img src="ces%20montessori%20encabezado.jpeg" alt="Encabezado del Informe">
                    </div>

                    <div style="text-align: center; margin-bottom: 4px;">
                        <p style="margin: 0; font-size: 14px; color: #000000; font-weight: bold; text-transform: uppercase;">Estado de Cuenta ${anio}</p>
                        <p style="margin: 2px 0 0 0; font-size: 11px; color: #000000; font-weight: bold; text-transform: uppercase;">Dirección Regional de Heredia - Circuito Escolar 04</p>
                        <p style="margin: 2px 0 0 0; font-size: 11px; color: #000000; font-weight: bold; text-transform: uppercase;">Centro Educativo Shkénuk</p>
                    </div>

                    <div style="margin-bottom: 6px; font-size: 11px; background: #f8fafc; padding: 6px 10px; border-radius: 6px; border: 1px solid var(--border); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                        <b>Estudiante:</b> ${estData.nombre} &nbsp;&nbsp;|&nbsp;&nbsp; <b>Cédula:</b> ${estData.cedula} &nbsp;&nbsp;|&nbsp;&nbsp; <b>Nivel:</b> ${estData.nivel} &nbsp;&nbsp;|&nbsp;&nbsp; <b>Corte:</b> ${nombreMesCorte} ${anio}
                    </div>

                    <div style="margin-bottom: 6px;">
                        <h4 style="color: var(--primary); margin: 0 0 4px 0; font-size: 12px;">Detalle de Rubros Anuales / Semestrales</h4>
                        <table class="data-table" style="font-size: 11px;">
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
            const nombreArchivo = `Estado_Cuenta_${estData.nombre.replace(/\s+/g, '_')}_${anioLectivoActivo}.pdf`;

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
            document.getElementById('mfa-qr-contenedor').innerHTML = `<img src="${data.totp.qr_code}" alt="Código QR MFA" style="width: 180px; height: 180px;">`;
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
