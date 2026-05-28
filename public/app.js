document.addEventListener('DOMContentLoaded', () => {
  // DOM Elements
  const appContainer = document.querySelector('.app-container');
  const uploadSection = document.getElementById('upload-section');
  const statusSection = document.getElementById('status-section');
  const doneSection = document.getElementById('done-section');
  const errorSection = document.getElementById('error-section');

  const dropZone = document.getElementById('drop-zone');
  const browseBtn = document.getElementById('browse-btn');
  const fileInput = document.getElementById('file-input');

  const progressIndicator = document.getElementById('progress-indicator');
  const progressPercent = document.getElementById('progress-percent');
  const jobTitle = document.getElementById('job-title');
  const jobSubtitle = document.getElementById('job-subtitle');

  const resetBtn = document.getElementById('reset-btn');
  const errorResetBtn = document.getElementById('error-reset-btn');
  const errorMessage = document.getElementById('error-message');

  // Dashboard DOM Elements
  const dashboardMeetingTitle = document.getElementById('dashboard-meeting-title');
  const dashboardSummary = document.getElementById('dashboard-summary');
  const dashboardAttendees = document.getElementById('dashboard-attendees');
  const dashboardQuestions = document.getElementById('dashboard-questions');
  const dashboardActionItems = document.getElementById('dashboard-action-items');
  const dashboardDecisions = document.getElementById('dashboard-decisions');
  const dashboardTranscript = document.getElementById('dashboard-transcript');
  const copyMarkdownBtn = document.getElementById('copy-markdown-btn');

  // Timeline Steps (No Notion step in v2)
  const steps = {
    queued: document.getElementById('step-queued'),
    transcribing: document.getElementById('step-transcribing'),
    mapping_speakers: document.getElementById('step-mapping_speakers'),
    extracting: document.getElementById('step-extracting')
  };

  // State
  let currentPollingInterval = null;
  let currentJobResult = null; // Holds completion payload
  const CIRCUMFERENCE = 2 * Math.PI * 54; // Radius r = 54

  // Setup Progress circle initial offset
  progressIndicator.style.strokeDasharray = CIRCUMFERENCE;
  progressIndicator.style.strokeDashoffset = CIRCUMFERENCE;

  // 1. File Selection / Drop Zone Events
  browseBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', handleFileSelect);

  ['dragenter', 'dragover'].forEach(eventName => {
    dropZone.addEventListener(eventName, (e) => {
      e.preventDefault();
      dropZone.classList.add('dragover');
    }, false);
  });

  ['dragleave', 'drop'].forEach(eventName => {
    dropZone.addEventListener(eventName, (e) => {
      e.preventDefault();
      dropZone.classList.remove('dragover');
    }, false);
  });

  dropZone.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    const files = dt.files;
    if (files.length > 0) {
      processFileSelection(files[0]);
    }
  });

  // Handle manual input click
  dropZone.addEventListener('click', (e) => {
    if (e.target !== browseBtn) {
      fileInput.click();
    }
  });

  function handleFileSelect(e) {
    if (e.target.files.length > 0) {
      processFileSelection(e.target.files[0]);
    }
  }

  // 2. Validate & Upload File
  function processFileSelection(file) {
    const allowedExtensions = ['.mp3', '.mp4', '.m4a', '.wav'];
    const fileExt = '.' + file.name.split('.').pop().toLowerCase();
    const maxSizeBytes = 500 * 1024 * 1024; // 500MB

    if (!allowedExtensions.includes(fileExt)) {
      showError('Invalid file type. Only .mp3, .mp4, .m4a, and .wav files are allowed.');
      return;
    }

    if (file.size > maxSizeBytes) {
      showError('File size limit exceeded. Maximum file size allowed is 500MB.');
      return;
    }

    uploadFile(file);
  }

  // Set visual progress ring
  function setProgress(percent) {
    const roundedPercent = Math.min(Math.max(Math.round(percent), 0), 100);
    progressPercent.textContent = `${roundedPercent}%`;
    const offset = CIRCUMFERENCE - (roundedPercent / 100) * CIRCUMFERENCE;
    progressIndicator.style.strokeDashoffset = offset;
  }

  // Switch display panel section
  function showSection(section) {
    [uploadSection, statusSection, doneSection, errorSection].forEach(sec => {
      sec.classList.remove('active');
    });
    section.classList.add('active');
    
    // Toggle container width dynamically based on layout
    if (section === doneSection) {
      appContainer.classList.add('dashboard-active');
    } else {
      appContainer.classList.remove('dashboard-active');
    }
  }

  // Reset timeline classes
  function resetTimeline() {
    Object.values(steps).forEach(step => {
      step.classList.remove('active', 'completed', 'failed');
    });
  }

  // Highlight step in timeline
  function updateTimelineSteps(currentStatus) {
    const stepOrder = ['queued', 'transcribing', 'mapping_speakers', 'extracting'];
    const currentIdx = stepOrder.indexOf(currentStatus);

    stepOrder.forEach((stepName, idx) => {
      const el = steps[stepName];
      if (!el) return;

      if (idx < currentIdx) {
        el.classList.remove('active', 'failed');
        el.classList.add('completed');
      } else if (idx === currentIdx) {
        el.classList.remove('completed', 'failed');
        el.classList.add('active');
      } else {
        el.classList.remove('completed', 'active', 'failed');
      }
    });
  }

  // 3. AJAX Upload Request
  function uploadFile(file) {
    showSection(statusSection);
    resetTimeline();
    setProgress(0);
    
    jobTitle.textContent = `Uploading ${file.name}`;
    jobSubtitle.textContent = 'Uploading to forge worker...';
    steps.queued.classList.add('active');

    const formData = new FormData();
    formData.append('file', file);

    const xhr = new XMLHttpRequest();
    
    // Track upload progress (allocated to first 25% of progress bar)
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        const uploadPercent = (e.loaded / e.total) * 25;
        setProgress(uploadPercent);
      }
    });

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const response = JSON.parse(xhr.responseText);
          const jobId = response.jobId;
          setProgress(25);
          startPolling(jobId, file.name);
        } catch (err) {
          showError('Invalid server response format.');
        }
      } else {
        try {
          const response = JSON.parse(xhr.responseText);
          showError(response.error || 'Server rejected file upload.');
        } catch (err) {
          showError(`Upload failed with status ${xhr.status}`);
        }
      }
    });

    xhr.addEventListener('error', () => {
      showError('Network error occurred during upload.');
    });

    xhr.open('POST', '/upload');
    xhr.send(formData);
  }

  // 4. Job Status Polling
  function startPolling(jobId, filename) {
    jobTitle.textContent = filename;
    jobSubtitle.textContent = 'Enqueued for forge processing...';

    if (currentPollingInterval) {
      clearInterval(currentPollingInterval);
    }

    currentPollingInterval = setInterval(() => {
      fetch(`/job/${jobId}/status`)
        .then(response => {
          if (!response.ok) {
            throw new Error(`Job poll failed: Status ${response.status}`);
          }
          return response.json();
        })
        .then(job => {
          // Adjust overall progress: upload takes 25%, processing maps the remaining 75%
          const overallProgress = 25 + (job.progress / 100) * 75;
          setProgress(overallProgress);

          if (job.status === 'done') {
            clearInterval(currentPollingInterval);
            handleSuccess(job.result);
          } else if (job.status === 'failed') {
            clearInterval(currentPollingInterval);
            
            // Mark current active step as failed
            const activeStep = document.querySelector('.timeline-step.active');
            if (activeStep) {
              activeStep.classList.remove('active');
              activeStep.classList.add('failed');
            }
            
            showError(job.error || 'An error occurred during meeting forge extraction.');
          } else {
            // Update active timeline step
            updateTimelineSteps(job.status);
            setSubtitleForState(job.status);
          }
        })
        .catch(err => {
          clearInterval(currentPollingInterval);
          showError(err.message);
        });
    }, 3000);
  }

  function setSubtitleForState(status) {
    const messages = {
      queued: 'Waiting in the processing forge queue...',
      transcribing: 'AssemblyAI is transcribing and separating speakers...',
      mapping_speakers: 'Groq is inferring speaker identities from dialogue...',
      extracting: 'Groq Llama 3.3 is compiling decisions and action items...'
    };
    jobSubtitle.textContent = messages[status] || 'Processing meeting...';
  }

  // Helper: formats string to display safe text
  function escapeHTML(str) {
    if (!str) return '';
    return str.replace(/[&<>'"]/g, 
      tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
    );
  }

  // 5. Success Dashboard Rendering
  function handleSuccess(result) {
    currentJobResult = result;
    const extraction = result.extraction || {};
    
    // Set Title and Summary
    dashboardMeetingTitle.textContent = extraction.title || 'Meeting Summary';
    dashboardSummary.textContent = extraction.summary || 'No summary available.';

    // Render Attendees List
    dashboardAttendees.innerHTML = '';
    if (extraction.attendees && extraction.attendees.length > 0) {
      extraction.attendees.forEach(name => {
        const li = document.createElement('li');
        li.textContent = name;
        dashboardAttendees.appendChild(li);
      });
    } else {
      dashboardAttendees.innerHTML = '<li>No attendees detected.</li>';
    }

    // Render Open Questions
    dashboardQuestions.innerHTML = '';
    if (extraction.openQuestions && extraction.openQuestions.length > 0) {
      extraction.openQuestions.forEach(question => {
        const li = document.createElement('li');
        li.textContent = question;
        dashboardQuestions.appendChild(li);
      });
    } else {
      dashboardQuestions.innerHTML = '<li>None</li>';
    }

    // Render Decisions List
    dashboardDecisions.innerHTML = '';
    if (extraction.keyDecisions && extraction.keyDecisions.length > 0) {
      extraction.keyDecisions.forEach(decision => {
        const li = document.createElement('li');
        li.textContent = decision;
        dashboardDecisions.appendChild(li);
      });
    } else {
      dashboardDecisions.innerHTML = '<li>No key decisions recorded.</li>';
    }

    // Render Action Items Checklist
    dashboardActionItems.innerHTML = '';
    if (extraction.actionItems && extraction.actionItems.length > 0) {
      extraction.actionItems.forEach(item => {
        const row = document.createElement('div');
        row.className = 'action-item-row';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'action-checkbox';

        const details = document.createElement('div');
        details.className = 'action-item-details';

        const task = document.createElement('div');
        task.className = 'action-task';
        task.textContent = item.task;

        const meta = document.createElement('div');
        meta.className = 'action-meta';

        if (item.owner) {
          const ownerBadge = document.createElement('span');
          ownerBadge.className = 'owner-badge';
          ownerBadge.textContent = item.owner;
          meta.appendChild(ownerBadge);
        }

        if (item.deadline) {
          const deadlineBadge = document.createElement('span');
          deadlineBadge.className = 'deadline-badge';
          deadlineBadge.textContent = item.deadline;
          meta.appendChild(deadlineBadge);
        }

        details.appendChild(task);
        if (item.owner || item.deadline) {
          details.appendChild(meta);
        }

        row.appendChild(checkbox);
        row.appendChild(details);
        
        // Checklist toggling
        checkbox.addEventListener('change', () => {
          if (checkbox.checked) {
            row.style.opacity = '0.6';
          } else {
            row.style.opacity = '1';
          }
        });

        dashboardActionItems.appendChild(row);
      });
    } else {
      dashboardActionItems.innerHTML = '<p class="empty-list-text">No action items detected.</p>';
    }

    // Render Transcript Turns
    dashboardTranscript.innerHTML = '';
    if (result.speakers && result.speakers.length > 0) {
      result.speakers.forEach(turn => {
        const turnDiv = document.createElement('div');
        turnDiv.className = 'transcript-turn';

        const speakerSpan = document.createElement('span');
        speakerSpan.className = 'transcript-speaker';
        
        // Format resolved name nicely
        const speakerName = turn.speaker.length === 1 || turn.speaker.toLowerCase().startsWith('speaker') 
          ? (turn.speaker.toLowerCase().startsWith('speaker') ? turn.speaker : `Speaker ${turn.speaker}`)
          : turn.speaker;
        
        speakerSpan.textContent = speakerName;

        const textPara = document.createElement('p');
        textPara.className = 'transcript-text';
        textPara.textContent = turn.text;

        turnDiv.appendChild(speakerSpan);
        turnDiv.appendChild(textPara);
        dashboardTranscript.appendChild(turnDiv);
      });
    } else if (result.transcript) {
      const textPara = document.createElement('p');
      textPara.className = 'transcript-text';
      textPara.textContent = result.transcript;
      dashboardTranscript.appendChild(textPara);
    } else {
      dashboardTranscript.innerHTML = '<p class="empty-list-text">No transcript text available.</p>';
    }

    // Reset tabs to default (Overview active)
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelector('[data-tab="overview"]').classList.add('active');
    document.querySelectorAll('.tab-panel').forEach(panel => panel.classList.remove('active'));
    document.getElementById('tab-overview').classList.add('active');

    showSection(doneSection);
  }

  // 6. Tab Navigation Event Listeners
  document.querySelectorAll('.tab-btn').forEach(button => {
    button.addEventListener('click', () => {
      const tabId = button.getAttribute('data-tab');
      
      // Update buttons
      document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
      button.classList.add('active');
      
      // Update panels
      document.querySelectorAll('.tab-panel').forEach(panel => panel.classList.remove('active'));
      document.getElementById(`tab-${tabId}`).classList.add('active');
    });
  });

  // 7. Generate Markdown & Copy Clipboard
  function generateMarkdown(result) {
    if (!result) return '';
    
    const extraction = result.extraction || {};
    let md = `# ${extraction.title || 'Meeting Summary'}\n\n`;
    
    md += `## Summary\n${extraction.summary || 'No summary available.'}\n\n`;
    
    if (extraction.attendees && extraction.attendees.length > 0) {
      md += `## Attendees\n`;
      extraction.attendees.forEach(name => {
        md += `- ${name}\n`;
      });
      md += `\n`;
    }
    
    if (extraction.keyDecisions && extraction.keyDecisions.length > 0) {
      md += `## Key Decisions\n`;
      extraction.keyDecisions.forEach((decision, idx) => {
        md += `${idx + 1}. ${decision}\n`;
      });
      md += `\n`;
    }
    
    if (extraction.actionItems && extraction.actionItems.length > 0) {
      md += `## Action Items\n`;
      extraction.actionItems.forEach(item => {
        const owner = item.owner ? ` [Owner: ${item.owner}]` : '';
        const deadline = item.deadline ? ` (Deadline: ${item.deadline})` : '';
        md += `- [ ]${owner} ${item.task}${deadline}\n`;
      });
      md += `\n`;
    }
    
    if (extraction.openQuestions && extraction.openQuestions.length > 0) {
      md += `## Open Questions\n`;
      extraction.openQuestions.forEach(question => {
        md += `- ${question}\n`;
      });
      md += `\n`;
    }
    
    if (result.speakers && result.speakers.length > 0) {
      md += `## Speaker Transcript\n`;
      result.speakers.forEach(turn => {
        const speakerName = turn.speaker.length === 1 || turn.speaker.toLowerCase().startsWith('speaker') 
          ? (turn.speaker.toLowerCase().startsWith('speaker') ? turn.speaker : `Speaker ${turn.speaker}`)
          : turn.speaker;
        md += `**${speakerName}**: ${turn.text}\n\n`;
      });
    } else if (result.transcript) {
      md += `## Transcript\n${result.transcript}\n`;
    }
    
    return md;
  }

  copyMarkdownBtn.addEventListener('click', () => {
    if (!currentJobResult) return;
    
    const markdown = generateMarkdown(currentJobResult);
    
    navigator.clipboard.writeText(markdown)
      .then(() => {
        // Simple success visual cue
        const originalText = copyMarkdownBtn.innerHTML;
        copyMarkdownBtn.innerHTML = `
          <svg class="btn-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
          </svg> Copied!
        `;
        copyMarkdownBtn.style.background = 'linear-gradient(135deg, var(--success-color), #059669)';
        
        setTimeout(() => {
          copyMarkdownBtn.innerHTML = originalText;
          copyMarkdownBtn.style.background = '';
        }, 2000);
      })
      .catch(err => {
        alert('Failed to copy to clipboard: ' + err);
      });
  });

  // 8. Error Screen Display
  function showError(msg) {
    if (currentPollingInterval) {
      clearInterval(currentPollingInterval);
    }
    errorMessage.textContent = msg;
    showSection(errorSection);
  }

  // 9. Reset Events
  function resetApp() {
    fileInput.value = '';
    currentJobResult = null;
    resetTimeline();
    setProgress(0);
    showSection(uploadSection);
  }

  resetBtn.addEventListener('click', resetApp);
  errorResetBtn.addEventListener('click', resetApp);
});
