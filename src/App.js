import React, { useState, useRef, useEffect } from 'react';
import { Settings, Image, Loader, Copy, Save, X, Sparkles, RefreshCcw, Bell } from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken } from 'firebase/auth';
import { getFirestore, doc, setDoc, onSnapshot } from 'firebase/firestore';

// Global constants provided by the Canvas environment.
// Do not modify these lines.
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

// Initialize Firebase if the config is available.
const app = Object.keys(firebaseConfig).length > 0 ? initializeApp(firebaseConfig) : null;
const auth = app ? getAuth(app) : null;
const db = app ? getFirestore(app) : null;

// Hook to handle authentication in a simple way
const useAuth = () => {
  const [userId, setUserId] = useState(null);
  useEffect(() => {
    const signIn = async () => {
      if (auth) {
        try {
          if (initialAuthToken) {
            await signInWithCustomToken(auth, initialAuthToken);
          } else {
            await signInAnonymously(auth);
          }
          setUserId(auth.currentUser?.uid || crypto.randomUUID());
        } catch (error) {
          console.error("Error signing in with Firebase:", error);
          setUserId('guest');
        }
      }
    };
    signIn();
  }, [auth, initialAuthToken]);
  return userId;
};

// Main application component
const App = () => {
  const userId = useAuth();
  const fileInputRef = useRef(null);
  const [selectedImage, setSelectedImage] = useState(null);
  const [base64Image, setBase64Image] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isConfigOpen, setIsConfigOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('gemini-api');

  // State for Gemini API configuration
  const [apiKey, setApiKey] = useState("");

  // State for Google Sheets configuration
  const [googleSheetId, setGoogleSheetId] = useState('');
  const [sheetName, setSheetName] = useState('');
  const [sheetNames, setSheetNames] = useState([]);
  const [sheetColumns, setSheetColumns] = useState([]);
  const [isFetchingSheets, setIsFetchingSheets] = useState(false);
  const [fieldMappings, setFieldMappings] = useState({
    originalTitle: '',
    originalText: '',
    englishTitle: '',
    englishText: '',
    contentType: '',
    aiArtStyle: '',
    summary: '',
    emailSubject: '',
    emailBody: ''
  });

  // State for Webhook configuration
  const [webhookUrl, setWebhookUrl] = useState('');
  const [isSendingWebhook, setIsSendingWebhook] = useState(false);
  const [webhookMessage, setWebhookMessage] = useState('');
  
  // State to save configuration
  const [showSavedMessage, setShowSavedMessage] = useState(false);
  
  const [results, setResults] = useState(null);
  const [summary, setSummary] = useState(null);
  const [emailDraft, setEmailDraft] = useState(null);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [isDraftingEmail, setIsDraftingEmail] = useState(false);

  // Field mapping for Google Sheets configuration
  const contentFields = [
    { key: 'originalTitle', label: 'Título Original' },
    { key: 'originalText', label: 'Contenido Original' },
    { key: 'englishTitle', label: 'Título en Inglés' },
    { key: 'englishText', label: 'Contenido en Inglés' },
    { key: 'contentType', label: 'Tipo de Contenido' },
    { key: 'aiArtStyle', label: 'Estilo de Arte' },
    { key: 'summary', label: 'Resumen' },
    { key: 'emailSubject', label: 'Asunto del Email' },
    { key: 'emailBody', label: 'Cuerpo del Email' }
  ];

  // Listen for changes in Firestore configuration
  useEffect(() => {
    if (db && userId && appId) {
      const docRef = doc(db, `artifacts/${appId}/users/${userId}/configurations/app-config`);
      const unsubscribe = onSnapshot(docRef, (docSnap) => {
        if (docSnap.exists()) {
          const config = docSnap.data();
          setApiKey(config.apiKey || '');
          setGoogleSheetId(config.googleSheetId || '');
          setSheetName(config.sheetName || '');
          setFieldMappings(config.fieldMappings || {});
          setWebhookUrl(config.webhookUrl || '');
          console.log("Configuration loaded from Firestore.");
        } else {
          console.log("No configuration found in Firestore.");
        }
      }, (error) => {
        console.error("Error listening to Firestore configuration:", error);
      });

      return () => unsubscribe();
    }
  }, [db, userId, appId]);

  // Handle image upload
  const handleImageUpload = (event) => {
    const file = event.target.files[0];
    if (file) {
      setSelectedImage(URL.createObjectURL(file));
      const reader = new FileReader();
      reader.onloadend = () => {
        setBase64Image(reader.result.split(',')[1]);
      };
      reader.readAsDataURL(file);
    }
  };

  // Function to send results to the webhook
  const sendToWebhook = async (data) => {
    if (!webhookUrl) {
      setWebhookMessage('Error: No se ha configurado una URL de webhook.');
      return;
    }

    setIsSendingWebhook(true);
    setWebhookMessage('Enviando datos al webhook...');

    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });

      if (response.ok) {
        setWebhookMessage('Datos enviados al webhook exitosamente.');
      } else {
        setWebhookMessage(`Error al enviar los datos al webhook. Código de estado: ${response.status}`);
      }
    } catch (error) {
      setWebhookMessage(`Error de red al enviar al webhook: ${error.message}`);
      console.error("Error sending to webhook:", error);
    } finally {
      setIsSendingWebhook(false);
    }
  };

  // Call the Google Gemini API to analyze the image
  const analyzeImage = async () => {
    if (!base64Image) {
      console.error("No image to analyze.");
      return;
    }
    if (!apiKey) {
      console.error("Please enter your API key.");
      return;
    }

    setIsLoading(true);
    setResults(null);
    setSummary(null);
    setEmailDraft(null);
    setWebhookMessage('');

    const prompt = `Extrae el texto de la imagen, genera un título en el idioma original, y luego traduce tanto el texto como el título al inglés. 
    Además, identifica el tipo de contenido (por ejemplo, "receta", "lista de la compra", "documento") y genera una sugerencia de estilo de arte para crear una imagen con IA, en inglés, 
    que sea relevante para el contenido. Devuelve todo en un objeto JSON con las siguientes claves: "originalTitle", "originalText", "englishTitle", "englishText", "contentType", "aiArtStyle". 
    Asegúrate de que el JSON sea válido.`;

    const chatHistory = [{
      role: "user",
      parts: [
        { text: prompt },
        {
          inlineData: {
            mimeType: "image/png",
            data: base64Image
          }
        }
      ]
    }];

    const payload = {
      contents: chatHistory,
      generationConfig: {
        responseMimeType: "application/json"
      }
    };
    
    // Use the Gemini API
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${apiKey}`;

    try {
      let response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      // Implement exponential backoff for retries
      const maxRetries = 5;
      let retryCount = 0;
      while (response.status === 429 && retryCount < maxRetries) {
        const delay = Math.pow(2, retryCount) * 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
        response = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        retryCount++;
      }

      const result = await response.json();
      
      if (result.candidates && result.candidates.length > 0 &&
        result.candidates[0].content && result.candidates[0].content.parts &&
        result.candidates[0].content.parts.length > 0) {
        
        const jsonString = result.candidates[0].content.parts[0].text;
        const parsedJson = JSON.parse(jsonString);
        setResults(parsedJson);
        
        // ** NEW FUNCTIONALITY: Send data to webhook **
        await sendToWebhook(parsedJson);

      } else {
        console.error('API response does not contain the expected format.');
      }
    } catch (error) {
      console.error("Error calling Gemini API:", error);
    } finally {
      setIsLoading(false);
    }
  };

  // Function to generate a summary of the text
  const generateSummary = async () => {
    if (!results || !results.originalText) return;
    setIsSummarizing(true);
    setSummary(null);

    const prompt = `Por favor, resume el siguiente texto de forma concisa:\n\n${results.originalText}`;
    const chatHistory = [{ role: "user", parts: [{ text: prompt }] }];
    const payload = { contents: chatHistory };
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${apiKey}`;
    
    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const result = await response.json();
      const text = result?.candidates?.[0]?.content?.parts?.[0]?.text;
      setSummary(text);
    } catch (error) {
      console.error("Error generating summary:", error);
    } finally {
      setIsSummarizing(false);
    }
  };

  // Function to generate an email draft
  const draftEmail = async () => {
    if (!results || !results.originalText) return;
    setIsDraftingEmail(true);
    setEmailDraft(null);

    const prompt = `Crea un borrador de correo electrónico profesional o un mensaje basado en el siguiente texto, usando el texto como el contenido principal. El resultado debe ser un objeto JSON con las claves "subject" y "body". Texto:\n\n${results.originalText}`;
    const chatHistory = [{ role: "user", parts: [{ text: prompt }] }];
    const payload = { 
      contents: chatHistory,
      generationConfig: {
        responseMimeType: "application/json"
      }
    };
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${apiKey}`;
    
    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const result = await response.json();
      const jsonString = result?.candidates?.[0]?.content?.parts?.[0]?.text;
      const parsedJson = JSON.parse(jsonString);
      setEmailDraft(parsedJson);
    } catch (error) {
      console.error("Error generating email draft:", error);
    } finally {
      setIsDraftingEmail(false);
    }
  };

  // Function to simulate fetching data from Google Sheets
  // In a real application, this would require a backend for authentication
  const fetchGoogleSheetData = async () => {
    if (!googleSheetId) {
      console.error("Please enter the Google Sheet ID.");
      return;
    }
    
    setIsFetchingSheets(true);
    
    // Simulate an API call
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    // Simulated data (sheet names and columns)
    const mockSheetNames = ['Datos', 'Resumen', 'Registros'];
    const mockColumns = [
      'Columna A', 'Columna B', 'Columna C', 'ID', 'Título', 'Contenido', 'Resumen'
    ];
    
    setSheetNames(mockSheetNames);
    setSheetColumns(mockColumns);
    setSheetName(mockSheetNames[0]);
    setIsFetchingSheets(false);
  };
  
  // Function to save the configuration to Firestore
  const saveConfiguration = async () => {
    if (!db || !userId || !appId) {
      console.error("Firebase or user ID not available.");
      return;
    }
    
    const configToSave = {
      apiKey,
      googleSheetId,
      sheetName,
      fieldMappings,
      webhookUrl,
    };
    
    try {
      const docRef = doc(db, `artifacts/${appId}/users/${userId}/configurations/app-config`);
      await setDoc(docRef, configToSave);
      setShowSavedMessage(true);
      setTimeout(() => {
        setShowSavedMessage(false);
        setIsConfigOpen(false);
      }, 2000);
      console.log("Configuration saved to Firestore.");
    } catch (e) {
      console.error("Error saving configuration to Firestore: ", e);
    }
  };

  // Function to copy text to the clipboard
  const copyToClipboard = (text) => {
    if (text) {
      const el = document.createElement('textarea');
      el.value = text;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
    }
  };

  // Result card component
  const ResultCard = ({ title, content, onCopyTitle, onCopyContent }) => (
    <div className="bg-white p-6 rounded-2xl shadow-lg border border-gray-200">
      <h3
        className="text-xl font-bold text-gray-800 cursor-pointer hover:text-indigo-600 transition-colors"
        onClick={onCopyTitle}
      >
        {title}
      </h3>
      <p
        className="text-gray-600 whitespace-pre-wrap mt-4 cursor-pointer hover:text-indigo-600 transition-colors"
        onClick={onCopyContent}
      >
        {content}
      </p>
    </div>
  );

  // Card component for content type and AI art style
  const AiPromptCard = ({ contentType, aiArtStyle }) => (
    <div className="bg-white p-6 rounded-2xl shadow-lg border border-gray-200 col-span-1 md:col-span-2 lg:col-span-1">
      <div className="flex flex-col space-y-4">
        <div className="flex flex-col">
          <h3 className="text-lg font-bold text-gray-800">Tipo de Contenido</h3>
          <p
            className="text-gray-600 mt-1 cursor-pointer hover:text-indigo-600 transition-colors"
            onClick={() => copyToClipboard(contentType)}
          >
            {contentType}
          </p>
        </div>
        <div className="flex flex-col">
          <h3 className="text-lg font-bold text-gray-800">Estilo de Arte IA</h3>
          <p
            className="text-gray-600 mt-1 cursor-pointer hover:text-indigo-600 transition-colors"
            onClick={() => copyToClipboard(aiArtStyle)}
          >
            {aiArtStyle}
          </p>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-100 p-8 font-sans antialiased text-gray-800">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap');
        body { font-family: 'Inter', sans-serif; }
      `}</style>
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <header className="flex justify-between items-center mb-8">
          <h1 className="text-4xl font-extrabold text-indigo-700">Gemini OCR</h1>
          <div className="flex items-center space-x-4">
            {userId && <span className="text-sm text-gray-500">ID de usuario: {userId}</span>}
            <button
              onClick={() => setIsConfigOpen(true)}
              className="p-2 rounded-full bg-white text-indigo-600 hover:bg-indigo-50 transition-colors shadow-md"
              title="Configuración"
            >
              <Settings size={24} />
            </button>
          </div>
        </header>

        {/* Main content */}
        <div className="bg-white p-8 rounded-2xl shadow-xl">
          <div className="flex flex-col md:flex-row gap-8 items-center md:items-start">
            {/* Image upload section */}
            <div className="flex-1 w-full md:w-auto">
              <label htmlFor="file-upload" className="block text-sm font-medium text-gray-700 mb-2">Cargar Imagen</label>
              <div className="relative border-2 border-dashed border-gray-300 rounded-xl p-6 cursor-pointer hover:bg-gray-50 transition-colors">
                <input
                  id="file-upload"
                  ref={fileInputRef}
                  type="file"
                  onChange={handleImageUpload}
                  className="absolute inset-0 opacity-0 cursor-pointer"
                  accept="image/*"
                />
                {selectedImage ? (
                  <img src={selectedImage} alt="Vista previa" className="max-h-64 rounded-xl object-contain mx-auto" />
                ) : (
                  <div className="flex flex-col items-center justify-center text-center text-gray-500">
                    <Image size={48} className="mb-2" />
                    <span className="font-medium">Arrastra y suelta o haz clic para subir</span>
                    <span className="text-sm mt-1">PNG, JPG, JPEG</span>
                  </div>
                )}
              </div>
            </div>
            
            {/* Action button */}
            <div className="flex-1 w-full md:w-auto self-center md:self-end">
              <button
                onClick={analyzeImage}
                disabled={!selectedImage || isLoading || !apiKey}
                className={`w-full py-4 px-6 rounded-xl font-bold text-white transition-all transform hover:scale-105 ${
                  selectedImage && apiKey && !isLoading ? 'bg-indigo-600 hover:bg-indigo-700 shadow-lg' : 'bg-gray-400 cursor-not-allowed'
                }`}
              >
                {isLoading ? (
                  <div className="flex items-center justify-center">
                    <Loader size={20} className="animate-spin mr-2" />
                    Analizando...
                  </div>
                ) : (
                  "Analizar Imagen"
                )}
              </button>
            </div>
          </div>
        </div>
        
        {/* Status messages */}
        {isLoading && (
          <div className="mt-4 p-4 text-center bg-blue-100 text-blue-800 rounded-xl">
            <p>El análisis de la imagen está en curso...</p>
          </div>
        )}
        {(isSendingWebhook && webhookMessage) && (
          <div className="mt-4 p-4 text-center bg-yellow-100 text-yellow-800 rounded-xl">
            <p>{webhookMessage}</p>
          </div>
        )}
        {(!isSendingWebhook && webhookMessage) && (
          <div className={`mt-4 p-4 text-center rounded-xl ${webhookMessage.startsWith('Error') ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800'}`}>
            <p>{webhookMessage}</p>
          </div>
        )}

        {/* Results area */}
        {results && (
          <div className="mt-8">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <ResultCard
                title={`Título: ${results.originalTitle}`}
                content={results.originalText}
                onCopyTitle={() => copyToClipboard(results.originalTitle)}
                onCopyContent={() => copyToClipboard(results.originalText)}
              />
              <ResultCard
                title={`Title: ${results.englishTitle}`}
                content={results.englishText}
                onCopyTitle={() => copyToClipboard(results.englishTitle)}
                onCopyContent={() => copyToClipboard(results.englishText)}
              />
              <AiPromptCard
                contentType={results.contentType}
                aiArtStyle={results.aiArtStyle}
              />
            </div>

            {/* New Gemini functionalities */}
            <div className="mt-8 p-6 bg-white rounded-2xl shadow-xl flex flex-col md:flex-row gap-4 justify-around items-center">
              <button
                onClick={generateSummary}
                disabled={isSummarizing || !apiKey}
                className={`flex-1 w-full md:w-auto flex items-center justify-center py-3 px-6 rounded-xl font-bold text-white transition-all transform hover:scale-105 ${
                  isSummarizing ? 'bg-gray-400 cursor-not-allowed' : 'bg-green-600 hover:bg-green-700 shadow-lg'
                }`}
              >
                {isSummarizing ? (
                  <div className="flex items-center justify-center">
                    <Loader size={20} className="animate-spin mr-2" />
                    Resumiendo...
                  </div>
                ) : (
                  <>
                    <Sparkles size={20} className="mr-2" /> Resumir Contenido
                  </>
                )}
              </button>
              <button
                onClick={draftEmail}
                disabled={isDraftingEmail || !apiKey}
                className={`flex-1 w-full md:w-auto flex items-center justify-center py-3 px-6 rounded-xl font-bold text-white transition-all transform hover:scale-105 ${
                  isDraftingEmail ? 'bg-gray-400 cursor-not-allowed' : 'bg-purple-600 hover:bg-purple-700 shadow-lg'
                }`}
              >
                {isDraftingEmail ? (
                  <div className="flex items-center justify-center">
                    <Loader size={20} className="animate-spin mr-2" />
                    Borrando email...
                  </div>
                ) : (
                  <>
                    <Sparkles size={20} className="mr-2" /> Borrar un Email
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {/* Section to show the summary */}
        {summary && (
          <div className="mt-8">
            <ResultCard
              title="Resumen del Contenido"
              content={summary}
              onCopyTitle={() => copyToClipboard("Resumen del Contenido")}
              onCopyContent={() => copyToClipboard(summary)}
            />
          </div>
        )}

        {/* Section to show the email draft */}
        {emailDraft && (
          <div className="mt-8">
            <div className="bg-white p-6 rounded-2xl shadow-lg border border-gray-200">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-xl font-bold text-gray-800">Borrador de Email</h3>
                <button
                  onClick={() => copyToClipboard(`Asunto: ${emailDraft.subject}\n\n${emailDraft.body}`)}
                  className="p-2 rounded-full text-gray-500 hover:bg-gray-100 transition-colors"
                >
                  <Copy size={20} />
                </button>
              </div>
              <p className="text-gray-600 whitespace-pre-wrap">
                <span className="font-bold">Asunto:</span> {emailDraft.subject}
                <br /><br />
                {emailDraft.body}
              </p>
            </div>
          </div>
        )}
      </div>
      
      {/* Saved configuration message */}
      {showSavedMessage && (
        <div className="fixed bottom-8 right-8 p-4 rounded-xl bg-green-500 text-white shadow-xl flex items-center space-x-2 animate-bounce-in-right">
          <Save size={20} />
          <span>Configuración guardada!</span>
        </div>
      )}

      {/* Configuration modal */}
      {isConfigOpen && (
        <div className="fixed inset-0 bg-gray-900 bg-opacity-75 flex items-center justify-center p-4">
          <div className="bg-white p-8 rounded-2xl shadow-2xl max-w-2xl w-full max-h-full overflow-y-auto">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold text-gray-800">Configuración</h2>
              <button onClick={() => setIsConfigOpen(false)} className="p-2 rounded-full text-gray-500 hover:bg-gray-100">
                <X size={24} />
              </button>
            </div>
            
            {/* Tab navigation */}
            <div className="flex border-b border-gray-200 mb-6">
              <button
                onClick={() => setActiveTab('gemini-api')}
                className={`flex-1 py-3 px-4 text-center text-sm font-medium transition-colors ${
                  activeTab === 'gemini-api' ? 'border-b-2 border-indigo-600 text-indigo-600' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                API de Gemini
              </button>
              <button
                onClick={() => setActiveTab('google-sheets')}
                className={`flex-1 py-3 px-4 text-center text-sm font-medium transition-colors ${
                  activeTab === 'google-sheets' ? 'border-b-2 border-indigo-600 text-indigo-600' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                Google Sheets
              </button>
              <button
                onClick={() => setActiveTab('webhook')}
                className={`flex-1 py-3 px-4 text-center text-sm font-medium transition-colors ${
                  activeTab === 'webhook' ? 'border-b-2 border-indigo-600 text-indigo-600' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                Webhook
              </button>
            </div>

            {/* Tab content */}
            <div className="space-y-6">
              {activeTab === 'gemini-api' && (
                <div>
                  <label htmlFor="api-key" className="block text-sm font-medium text-gray-700 mb-1">Clave de API de Google Gemini</label>
                  <input
                    id="api-key"
                    type="text"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                    placeholder="Ingresa tu clave de API aquí"
                  />
                </div>
              )}

              {activeTab === 'google-sheets' && (
                <div>
                  <h3 className="text-lg font-bold text-gray-800 mb-4">Integración con Google Sheets</h3>
                  <div className="space-y-4">
                    <div className="flex flex-col md:flex-row items-end gap-4">
                      <div className="flex-1 w-full">
                        <label htmlFor="sheet-id" className="block text-sm font-medium text-gray-700 mb-1">ID de Google Sheet</label>
                        <input
                          id="sheet-id"
                          type="text"
                          value={googleSheetId}
                          onChange={(e) => setGoogleSheetId(e.target.value)}
                          className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                          placeholder="ID del documento"
                        />
                      </div>
                      <button
                        onClick={fetchGoogleSheetData}
                        disabled={isFetchingSheets || !googleSheetId}
                        className={`px-6 py-3 rounded-lg font-bold text-white transition-all transform ${isFetchingSheets || !googleSheetId ? 'bg-gray-400 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-700 shadow-md'}`}
                      >
                        {isFetchingSheets ? (
                          <div className="flex items-center">
                            <Loader size={20} className="animate-spin mr-2" />
                            Cargando...
                          </div>
                        ) : (
                          "Obtener Información"
                        )}
                      </button>
                    </div>

                    {sheetNames.length > 0 && (
                      <div className="mt-4">
                        <label htmlFor="sheet-name-select" className="block text-sm font-medium text-gray-700 mb-1">Nombre de la Hoja</label>
                        <select
                          id="sheet-name-select"
                          value={sheetName}
                          onChange={(e) => setSheetName(e.target.value)}
                          className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                        >
                          {sheetNames.map((name, index) => (
                            <option key={index} value={name}>{name}</option>
                          ))}
                        </select>
                      </div>
                    )}

                    <p className="text-sm text-gray-500 mt-2">
                      Nota: La integración completa con Google Sheets requiere un servicio de backend para la autenticación y el manejo de la API. Esta interfaz es solo para la configuración de los campos.
                    </p>

                    <h4 className="text-base font-bold text-gray-700 mt-6">Mapeo de Campos</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {contentFields.map(field => (
                        <div key={field.key}>
                          <label className="block text-sm font-medium text-gray-700 mb-1">{field.label}</label>
                          <select
                            value={fieldMappings[field.key]}
                            onChange={(e) => setFieldMappings({ ...fieldMappings, [field.key]: e.target.value })}
                            className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                          >
                            <option value="">Seleccionar Columna</option>
                            {sheetColumns.map((col, index) => (
                              <option key={index} value={col}>{col}</option>
                            ))}
                          </select>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'webhook' && (
                <div>
                  <h3 className="text-lg font-bold text-gray-800 mb-4">Configuración de Webhook</h3>
                  <div>
                    <label htmlFor="webhook-url" className="block text-sm font-medium text-gray-700 mb-1">URL del Webhook</label>
                    <input
                      id="webhook-url"
                      type="url"
                      value={webhookUrl}
                      onChange={(e) => setWebhookUrl(e.target.value)}
                      className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                      placeholder="https://ejemplo.com/mi-webhook"
                    />
                    <p className="text-sm text-gray-500 mt-2">
                      Introduce un URL para enviar notificaciones o datos generados. La aplicación enviará una solicitud `POST` a este URL.
                    </p>
                  </div>
                </div>
              )}
            </div>
            
            {/* Modal action buttons */}
            <div className="mt-8 flex justify-end space-x-4">
              <button
                onClick={() => setIsConfigOpen(false)}
                className="px-6 py-3 rounded-lg font-bold text-white bg-red-500 hover:bg-red-600 transition-colors shadow-md"
              >
                Cancelar
              </button>
              <button
                onClick={saveConfiguration}
                className="px-6 py-3 rounded-lg font-bold text-white bg-green-500 hover:bg-green-600 transition-colors shadow-md"
              >
                Guardar
              </button>
            </div>

          </div>
        </div>
      )}
    </div>
  );
};

export default App;
