// TMDB API Configuration
const API_KEY = '42930192f4d364293d1f83673b61a67b';
const API_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiI0MjkzMDE5MmY0ZDM2NDI5M2QxZjgzNjczYjYxYTY3YiIsIm5iZiI6MTczMTk1MTYxOS41MDg3MzIzLCJzdWIiOiI2NzNiN2JhZGU4MzFmOGFhNDllMzU2NDAiLCJzY29wZXMiOlsiYXBpX3JlYWQiXSwidmVyc2lvbiI6MX0.pjB1YelebK8_iGj-w4oycPOmly1ytiUhrDmEtxUO86E';
const API_BASE_URL = 'https://api.themoviedb.org/3';
const IMAGE_BASE_URL = 'https://image.tmdb.org/t/p/w500';
const DEFAULT_POSTER = './images/no-poster.svg';
const WATCHLIST_KEY = 'movie_watchlist';

// Cache
const cache = new Map();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

// Image cache for checking if images exist
const imageCache = new Map();

// State Management
let currentPage = 1;
let totalPages = 1;
let yearRange = [1900, new Date().getFullYear()];
let ratingRange = [0, 10];
let selectedGenres = new Set();
let currentSort = 'popularity.desc';
let searchTimeout;
let isLoading = false;
let hasMoreResults = true;
let showWatchlistOnly = false;

// DOM Elements
const searchInput = document.getElementById('searchInput');
const searchSuggestions = document.getElementById('searchSuggestions');
const movieResults = document.getElementById('movieResults');
const loader = document.getElementById('loader');
const yearSlider = document.getElementById('yearSlider');
const ratingSlider = document.getElementById('ratingSlider');
const yearFrom = document.getElementById('yearFrom');
const yearTo = document.getElementById('yearTo');
const genresList = document.getElementById('genresList');
const sortBy = document.getElementById('sortBy');
const clearFilters = document.getElementById('clearFilters');
const toggleWatchlistBtn = document.getElementById('toggleWatchlistBtn');

// Initialize the application
document.addEventListener('DOMContentLoaded', async () => {
    await initializeFilters();
    setupEventListeners();
    performSearch();
});

// Initialize filters and sliders
async function initializeFilters() {
    // Initialize year slider
    noUiSlider.create(yearSlider, {
        start: yearRange,
        connect: true,
        step: 1,
        range: {
            'min': 1900,
            'max': new Date().getFullYear()
        }
    });

    // Initialize rating slider
    noUiSlider.create(ratingSlider, {
        start: [0],
        connect: [true, false],
        step: 0.5,
        range: {
            'min': 0,
            'max': 10
        }
    });

    // Load genres
    const genres = await fetchGenres();
    displayGenres(genres);

    // Setup slider events
    yearSlider.noUiSlider.on('update', debounce((values) => {
        yearRange = values.map(Number);
        yearFrom.value = Math.round(yearRange[0]);
        yearTo.value = Math.round(yearRange[1]);
        resetSearch();
        performSearch();
    }, 500));

    ratingSlider.noUiSlider.on('update', debounce((values) => {
        ratingRange[0] = Number(values[0]);
        document.getElementById('ratingValue').textContent = `${ratingRange[0]}+`;
        resetSearch();
        performSearch();
    }, 500));
}

// Event Listeners
function setupEventListeners() {
    // Search input event listeners
    searchInput.addEventListener('input', handleSearchInput);
    searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            currentPage = 1;
            performSearch();
        }
    });

    // Infinite scroll
    window.addEventListener('scroll', () => {
        if (!isLoading && isNearBottom() && hasMoreResults) {
            currentPage++;
            performSearch(true);
        }
    });

    // Filter event listeners
    yearFrom.addEventListener('change', () => {
        yearRange[0] = parseInt(yearFrom.value);
        currentPage = 1;
        performSearch();
    });

    yearTo.addEventListener('change', () => {
        yearRange[1] = parseInt(yearTo.value);
        currentPage = 1;
        performSearch();
    });

    sortBy.addEventListener('change', () => {
        currentSort = sortBy.value;
        currentPage = 1;
        performSearch();
    });

    // Clear filters
    clearFilters.addEventListener('click', resetFilters);

    // Watchlist toggle
    if (toggleWatchlistBtn) {
        toggleWatchlistBtn.addEventListener('click', (e) => {
            e.preventDefault();
            showWatchlistOnly = !showWatchlistOnly;
            toggleWatchlistBtn.classList.toggle('active');
            currentPage = 1;
            performSearch();
        });
    }
}

// Perform search with filters
async function performSearch(append = false) {
    if (isLoading) return;
    isLoading = true;
    
    if (!append) {
        showLoader();
        movieResults.innerHTML = '';
    }

    const query = searchInput.value.trim();
    let endpoint = '/discover/movie';
    let params = {
        sort_by: currentSort,
        'vote_count.gte': 100,
        'primary_release_date.gte': `${yearRange[0]}-01-01`,
        'primary_release_date.lte': `${yearRange[1]}-12-31`,
        'vote_average.gte': ratingRange[0],
        with_genres: Array.from(selectedGenres).join(','),
        page: currentPage
    };

    if (query) {
        endpoint = '/search/movie';
        params.query = query;
    }

    try {
        const data = await fetchFromTMDB(endpoint, params);
        totalPages = data.total_pages;
        hasMoreResults = currentPage < totalPages;

        if (data.results.length === 0) {
            movieResults.innerHTML = `
                <div class="error-banner info">
                    <div class="error-content">
                        <svg viewBox="0 0 24 24">
                            <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
                        </svg>
                        <div>
                            <h3>No movies found</h3>
                            <p>Try adjusting your filters</p>
                        </div>
                    </div>
                </div>
            `;
            hideLoader();
            return;
        }

        // Get watchlist for filtering
        const watchlist = getWatchlist();
        let moviesToDisplay = data.results;

        // Filter by watchlist if needed
        if (showWatchlistOnly) {
            moviesToDisplay = data.results.filter(movie => watchlist.includes(movie.id));
            if (moviesToDisplay.length === 0) {
                movieResults.innerHTML = `
                    <div class="error-banner warning">
                        <div class="error-content">
                            <svg viewBox="0 0 24 24">
                                <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
                            </svg>
                            <div>
                                <h3>No movies in watchlist match your filters</h3>
                                <p>Try adjusting your filters or add more movies to your watchlist</p>
                            </div>
                        </div>
                    </div>
                `;
                hideLoader();
                return;
            }
        }

        const movieCards = await Promise.all(moviesToDisplay.map(async movie => {
            const movieDetails = await fetchFromTMDB(`/movie/${movie.id}?append_to_response=videos,credits`);
            const trailer = movieDetails.videos?.results.find(
                v => v.type === "Trailer" && v.site === "YouTube"
            );

            const director = movieDetails.credits?.crew.find(
                person => person.job === "Director"
            );

            const cast = movieDetails.credits?.cast.slice(0, 3).map(actor => actor.name).join(', ');
            const posterPath = movie.poster_path
                ? `${IMAGE_BASE_URL}${movie.poster_path}`
                : DEFAULT_POSTER;

            const isInList = watchlist.includes(movie.id);

            return `
                <div class="movie-card">
                    <div class="movie-poster">
                        <img src="${posterPath}" 
                             alt="${movie.title}"
                             onerror="this.onerror=null; this.src='${DEFAULT_POSTER}'">
                        <div class="movie-overlay">
                            <div class="movie-overview">
                                <p>${movie.overview || 'No overview available.'}</p>
                                ${director ? `<p class="director"><strong>Director:</strong> ${director.name}</p>` : ''}
                                ${cast ? `<p class="cast"><strong>Cast:</strong> ${cast}</p>` : ''}
                            </div>
                            <div class="movie-actions">
                                ${trailer ? `
                                    <button class="trailer-btn" onclick="playTrailer('${trailer.key}')">
                                        <svg viewBox="0 0 24 24" width="24" height="24">
                                            <path fill="currentColor" d="M8 5v14l11-7z"/>
                                        </svg>
                                        Watch Trailer
                                    </button>
                                ` : ''}
                                <button class="watchlist-btn ${isInList ? 'in-watchlist' : ''}" 
                                        data-movie-id="${movie.id}"
                                        onclick="toggleWatchlist(${movie.id})">
                                    <svg viewBox="0 0 24 24">
                                        <path fill="currentColor" d="${isInList ? 
                                            'M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z' : 
                                            'M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z'
                                        }"/>
                                    </svg>
                                    ${isInList ? 'Remove from Watchlist' : 'Add to Watchlist'}
                                </button>
                            </div>
                        </div>
                    </div>
                    <div class="movie-info">
                        <h3>${movie.title}</h3>
                        <div class="movie-meta">
                            <span>${movie.release_date?.split('-')[0] || 'N/A'}</span>
                            <span>${movie.vote_average.toFixed(1)}⭐</span>
                        </div>
                    </div>
                </div>
            `;
        }));

        if (!append) {
            movieResults.innerHTML = '';
        }
        movieResults.insertAdjacentHTML('beforeend', movieCards.join(''));

    } catch (error) {
        console.error('Error performing search:', error);
        if (!append) {
            movieResults.innerHTML = `
                <div class="error-banner error">
                    <div class="error-content">
                        <svg viewBox="0 0 24 24">
                            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z"/>
                        </svg>
                        <div>
                            <h3>An error occurred</h3>
                            <p>Please try again later</p>
                        </div>
                    </div>
                </div>
            `;
        }
    } finally {
        isLoading = false;
        hideLoader();
    }
}

// Watchlist Functions
function getWatchlist() {
    const watchlist = localStorage.getItem(WATCHLIST_KEY);
    return watchlist ? JSON.parse(watchlist) : [];
}

function toggleWatchlist(movieId) {
    const watchlist = getWatchlist();
    const index = watchlist.indexOf(movieId);
    
    if (index > -1) {
        watchlist.splice(index, 1);
    } else {
        watchlist.push(movieId);
    }
    
    localStorage.setItem(WATCHLIST_KEY, JSON.stringify(watchlist));
    updateWatchlistButton(movieId, index === -1);

    // If showing watchlist only, refresh the results
    if (showWatchlistOnly) {
        currentPage = 1;
        performSearch();
    }
}

function updateWatchlistButton(movieId, isInList) {
    const buttons = document.querySelectorAll(`.watchlist-btn[data-movie-id="${movieId}"]`);
    buttons.forEach(button => {
        if (isInList) {
            button.classList.add('in-watchlist');
            button.innerHTML = `
                <svg viewBox="0 0 24 24">
                    <path fill="currentColor" d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/>
                </svg>
                Remove from Watchlist
            `;
        } else {
            button.classList.remove('in-watchlist');
            button.innerHTML = `
                <svg viewBox="0 0 24 24">
                    <path fill="currentColor" d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
                </svg>
                Add to Watchlist
            `;
        }
    });
}

// Infinite Scroll Functions
function isNearBottom() {
    const threshold = 200; // pixels from bottom
    return (window.innerHeight + window.scrollY) >= (document.documentElement.scrollHeight - threshold);
}

async function loadMoreResults() {
    if (currentPage < totalPages) {
        currentPage++;
        await performSearch(true);
    }
}

function resetSearch() {
    currentPage = 1;
    hasMoreResults = true;
    movieResults.innerHTML = '';
}

// Search Input Handler
async function handleSearchInput(e) {
    const query = e.target.value.trim();
    
    if (query.length > 0) {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(async () => {
            try {
                const results = await Promise.all([
                    fetchFromTMDB('/search/movie', { query, page: 1 }),
                    fetchFromTMDB('/search/person', { query, page: 1 }),
                    fetchFromTMDB('/search/keyword', { query, page: 1 })
                ]);

                const [movies, people, keywords] = results;
                const genres = await fetchGenres();
                const matchedGenres = genres.filter(genre => 
                    genre.name.toLowerCase().includes(query.toLowerCase())
                );

                displaySuggestions({
                    movies: movies.results.slice(0, 3),
                    people: people.results.slice(0, 3),
                    genres: matchedGenres.slice(0, 3),
                    keywords: keywords.results.slice(0, 3)
                });
            } catch (error) {
                console.error('Error getting search suggestions:', error);
            }
        }, 300);
        searchSuggestions.style.display = 'block';
    } else {
        searchSuggestions.style.display = 'none';
    }
}

// Display search suggestions
function displaySuggestions({ movies, people, genres, keywords }) {
    let html = '';

    // Movies section
    if (movies.length > 0) {
        html += '<div class="suggestion-section"><h4>Movies</h4>';
        movies.forEach(movie => {
            const year = movie.release_date ? `(${movie.release_date.split('-')[0]})` : '';
            const posterPath = movie.poster_path
                ? `${IMAGE_BASE_URL}${movie.poster_path}`
                : DEFAULT_POSTER;
            html += `
                <div class="suggestion-item" onclick="selectMovie(${movie.id})">
                    <img src="${posterPath}" alt="${movie.title}" onerror="this.src='${DEFAULT_POSTER}'">
                    <div class="suggestion-info">
                        <span class="title">${movie.title} ${year}</span>
                        <span class="sub">${movie.vote_average.toFixed(1)}⭐</span>
                    </div>
                </div>
            `;
        });
        html += '</div>';
    }

    // People section (Actors & Directors)
    if (people.length > 0) {
        html += '<div class="suggestion-section"><h4>People</h4>';
        people.forEach(person => {
            const profilePath = person.profile_path
                ? `${IMAGE_BASE_URL}${person.profile_path}`
                : DEFAULT_POSTER;
            html += `
                <div class="suggestion-item" onclick="selectPerson(${person.id})">
                    <img src="${profilePath}" alt="${person.name}" onerror="this.src='${DEFAULT_POSTER}'">
                    <div class="suggestion-info">
                        <span class="title">${person.name}</span>
                        <span class="sub">${person.known_for_department}</span>
                    </div>
                </div>
            `;
        });
        html += '</div>';
    }

    // Genres section
    if (genres.length > 0) {
        html += '<div class="suggestion-section"><h4>Genres</h4>';
        genres.forEach(genre => {
            html += `
                <div class="suggestion-item" onclick="selectGenre(${genre.id})">
                    <div class="suggestion-info">
                        <span class="title">${genre.name}</span>
                    </div>
                </div>
            `;
        });
        html += '</div>';
    }

    // Keywords section
    if (keywords.length > 0) {
        html += '<div class="suggestion-section"><h4>Keywords</h4>';
        keywords.forEach(keyword => {
            html += `
                <div class="suggestion-item" onclick="selectKeyword(${keyword.id})">
                    <div class="suggestion-info">
                        <span class="title">${keyword.name}</span>
                    </div>
                </div>
            `;
        });
        html += '</div>';
    }

    if (html === '') {
        html = '<div class="no-suggestions">No results found</div>';
    }

    searchSuggestions.innerHTML = html;
}

// Selection handlers
async function selectMovie(movieId) {
    searchSuggestions.style.display = 'none';
    showLoader();
    
    try {
        const movie = await fetchFromTMDB(`/movie/${movieId}?append_to_response=videos,credits`);
        searchInput.value = movie.title;
        
        // Reset filters
        currentPage = 1;
        selectedGenres.clear();
        movie.genres.forEach(genre => selectedGenres.add(genre.id.toString()));
        yearRange = [
            new Date(movie.release_date).getFullYear(),
            new Date(movie.release_date).getFullYear()
        ];
        
        // Update UI
        updateFilterUI();
        performSearch();
    } catch (error) {
        console.error('Error selecting movie:', error);
        showError('Failed to load movie details');
    }
}

async function selectPerson(personId) {
    searchSuggestions.style.display = 'none';
    showLoader();
    
    try {
        const person = await fetchFromTMDB(`/person/${personId}`);
        searchInput.value = person.name;
        
        // Reset filters
        currentPage = 1;
        selectedGenres.clear();
        
        // Search for movies by person
        const endpoint = person.known_for_department === 'Directing' 
            ? '/discover/movie?with_crew=' 
            : '/discover/movie?with_cast=';
            
        const data = await fetchFromTMDB(endpoint + personId);
        
        // Display results
        displayMovieResults(data.results);
    } catch (error) {
        console.error('Error selecting person:', error);
        showError('Failed to load person\'s movies');
    }
}

function selectGenre(genreId) {
    searchSuggestions.style.display = 'none';
    selectedGenres.clear();
    selectedGenres.add(genreId.toString());
    updateFilterUI();
    currentPage = 1;
    performSearch();
}

async function selectKeyword(keywordId) {
    searchSuggestions.style.display = 'none';
    showLoader();
    
    try {
        const data = await fetchFromTMDB('/discover/movie', {
            with_keywords: keywordId,
            page: 1
        });
        
        currentPage = 1;
        displayMovieResults(data.results);
    } catch (error) {
        console.error('Error selecting keyword:', error);
        showError('Failed to load movies with this keyword');
    }
}

function updateFilterUI() {
    // Update year slider
    if (yearSlider.noUiSlider) {
        yearSlider.noUiSlider.set(yearRange);
    }
    yearFrom.value = yearRange[0];
    yearTo.value = yearRange[1];

    // Update genre checkboxes
    document.querySelectorAll('.genre-checkbox').forEach(checkbox => {
        checkbox.checked = selectedGenres.has(checkbox.value);
    });
}

// Helper function to display movie results
function displayMovieResults(movies) {
    if (movies.length === 0) {
        movieResults.innerHTML = `
            <div class="error-banner info">
                <div class="error-content">
                    <svg viewBox="0 0 24 24">
                        <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
                    </svg>
                    <div>
                        <h3>No movies found</h3>
                        <p>Try adjusting your search criteria</p>
                    </div>
                </div>
            </div>
        `;
    } else {
        const movieCards = movies.map(movie => createMovieCard(movie)).join('');
        movieResults.innerHTML = movieCards;
    }
    hideLoader();
}

// API Calls with Caching
async function fetchFromTMDB(endpoint, params = {}) {
    const cacheKey = endpoint + JSON.stringify(params);
    const cachedData = cache.get(cacheKey);
    
    if (cachedData && Date.now() - cachedData.timestamp < CACHE_DURATION) {
        return cachedData.data;
    }

    const queryParams = new URLSearchParams({
        api_key: API_KEY,
        ...params
    }).toString();

    try {
        const response = await fetch(`${API_BASE_URL}${endpoint}?${queryParams}`, {
            headers: {
                'Authorization': `Bearer ${API_TOKEN}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`TMDB API Error: ${response.status}`);
        }

        const data = await response.json();
        cache.set(cacheKey, {
            data,
            timestamp: Date.now()
        });

        return data;
    } catch (error) {
        console.error('API Error:', error);
        throw error;
    }
}

async function getSearchSuggestions(query) {
    const [movies, people] = await Promise.all([
        fetchFromTMDB('/search/movie', { query, include_adult: false }),
        fetchFromTMDB('/search/person', { query })
    ]);

    const personMovies = await Promise.all(
        people.results.slice(0, 3).map(person =>
            fetchFromTMDB(`/person/${person.id}/movie_credits`)
        )
    );

    return {
        movies: movies.results.slice(0, 5),
        people: people.results.slice(0, 3).map((person, index) => ({
            ...person,
            movies: personMovies[index].cast.slice(0, 3)
        }))
    };
}

async function fetchGenres() {
    try {
        const data = await fetchFromTMDB('/genre/movie/list');
        return data.genres;
    } catch (error) {
        console.error('Error fetching genres:', error);
        return [];
    }
}

// Display Functions
function displayGenres(genres) {
    genresList.innerHTML = genres.map(genre => `
        <div class="genre-tag" data-id="${genre.id}">
            ${genre.name}
        </div>
    `).join('');

    // Add click events to genre tags
    genresList.querySelectorAll('.genre-tag').forEach(tag => {
        tag.addEventListener('click', () => {
            const genreId = tag.dataset.id;
            tag.classList.toggle('active');
            
            if (selectedGenres.has(genreId)) {
                selectedGenres.delete(genreId);
            } else {
                selectedGenres.add(genreId);
            }
            
            resetSearch();
            performSearch();
        });
    });
}

// Trailer Function
function playTrailer(videoKey) {
    const modal = document.createElement('div');
    modal.className = 'trailer-modal';
    modal.innerHTML = `
        <div class="trailer-content">
            <button class="close-trailer">&times;</button>
            <iframe
                width="100%"
                height="100%"
                src="https://www.youtube.com/embed/${videoKey}?autoplay=1"
                frameborder="0"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowfullscreen
            ></iframe>
        </div>
    `;

    document.body.appendChild(modal);
    document.body.style.overflow = 'hidden';

    const closeButton = modal.querySelector('.close-trailer');
    closeButton.addEventListener('click', () => {
        document.body.removeChild(modal);
        document.body.style.overflow = 'auto';
    });

    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            document.body.removeChild(modal);
            document.body.style.overflow = 'auto';
        }
    });
}

// Utility Functions
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

function getGenreName(id) {
    const genres = Array.from(genresList.children);
    const genre = genres.find(g => g.dataset.id === String(id));
    return genre ? genre.textContent.trim() : '';
}

// Reset Filters
function resetFilters() {
    yearSlider.noUiSlider.reset();
    ratingSlider.noUiSlider.reset();
    selectedGenres.clear();
    genresList.querySelectorAll('.genre-tag').forEach(tag => {
        tag.classList.remove('active');
    });
    sortBy.value = 'popularity.desc';
    currentSort = 'popularity.desc';
    document.getElementById('includeAdult').checked = false;
    document.getElementById('onlyWithPosters').checked = false;
    document.getElementById('onlyWithRatings').checked = false;
    resetSearch();
    performSearch();
}

// Loader Functions
function showLoader() {
    loader.classList.remove('hidden');
}

function hideLoader() {
    loader.classList.add('hidden');
}

function showError(message) {
    movieResults.innerHTML = `
        <div class="error-banner error">
            <div class="error-content">
                <svg viewBox="0 0 24 24">
                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z"/>
                </svg>
                <div>
                    <h3>An error occurred</h3>
                    <p>${message}</p>
                </div>
            </div>
        </div>
    `;
}

function createMovieCard(movie) {
    const posterPath = movie.poster_path
        ? `${IMAGE_BASE_URL}${movie.poster_path}`
        : DEFAULT_POSTER;

    const isInList = getWatchlist().includes(movie.id);

    return `
        <div class="movie-card">
            <div class="movie-poster">
                <img src="${posterPath}" 
                     alt="${movie.title}"
                     onerror="this.onerror=null; this.src='${DEFAULT_POSTER}'">
                <div class="movie-overlay">
                    <div class="movie-overview">
                        <p>${movie.overview || 'No overview available.'}</p>
                    </div>
                    <div class="movie-actions">
                        <button class="watchlist-btn ${isInList ? 'in-watchlist' : ''}" 
                                data-movie-id="${movie.id}"
                                onclick="toggleWatchlist(${movie.id})">
                            <svg viewBox="0 0 24 24">
                                <path fill="currentColor" d="${isInList ? 
                                    'M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z' : 
                                    'M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z'
                                }"/>
                            </svg>
                            ${isInList ? 'Remove from Watchlist' : 'Add to Watchlist'}
                        </button>
                    </div>
                </div>
            </div>
            <div class="movie-info">
                <h3>${movie.title}</h3>
                <div class="movie-meta">
                    <span>${movie.release_date?.split('-')[0] || 'N/A'}</span>
                    <span>${movie.vote_average.toFixed(1)}⭐</span>
                </div>
            </div>
        </div>
    `;
}
